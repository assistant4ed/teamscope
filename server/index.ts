/**
 * Teamscope backend: Express server that serves the built Vite frontend
 * AND exposes typed REST endpoints on top of the Supabase `ops` schema.
 *
 * Auth model:
 *   - Clients identify themselves by `X-User-Email` header.
 *   - Email whitelist + role is configured via env:
 *       ALLOWED_USERS=email1:boss,email2:pa,email3:colleague
 *   - Anything not whitelisted gets 401.
 *   - Boss: full access. PA: can claim/complete tasks + see everyone's
 *     reports. Colleague: own data only.
 *
 * Database access is via direct pg pool to the Supabase session pooler
 * using the service role's SUPABASE_DB_URL — PostgREST's exposed-schema
 * restriction doesn't apply.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeCrypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  SUPABASE_DB_URL,
  ALLOWED_USERS = 'hobbychan111@gmail.com:boss',
  PORT = '3000',
  NODE_ENV = 'production',
  // Used by the outbound Telegram notifier. Both optional — the
  // notifier becomes a no-op if the token is missing.
  TELEGRAM_BOT_TOKEN = '',
  APP_URL = '',
  // Image-pipeline credentials — all optional. Without GEMINI_API_KEY
  // the image analyzer falls back to no-vision-available; without the
  // CF_IMAGES_* trio the analyzer skips persistence and just returns
  // the description.
  GEMINI_API_KEY = '',
  CLOUDFLARE_ACCOUNT_ID = '',
  CF_IMAGES_TOKEN = '',
  CF_IMAGES_ACCOUNT_HASH = '',
  // Email — Resend. Without RESEND_API_KEY the dispatcher logs and
  // skips silently so dev / preview deploys don't error.
  RESEND_API_KEY = '',
  EMAIL_FROM = 'noreply@clipyai.app',
  EMAIL_FROM_NAME = 'TeamScope',
} = process.env;

if (!SUPABASE_DB_URL) {
  console.error('[teamscope] FATAL: SUPABASE_DB_URL must be set.');
  process.exit(1);
}

// ---------- Auth whitelist ---------------------------------------- //
type Role = 'boss' | 'pa' | 'colleague';
interface AppUser { email: string; role: Role }

const USERS: Record<string, AppUser> = Object.fromEntries(
  ALLOWED_USERS.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [email, role = 'colleague'] = pair.split(':').map(x => x.trim());
      return [email.toLowerCase(), { email: email.toLowerCase(), role: role as Role }];
    })
);

console.log(`[teamscope] loaded ${Object.keys(USERS).length} whitelisted user(s)`);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AppUser }
  }
}

function requireUser(req: Request, res: Response, next: NextFunction) {
  const raw = (req.header('x-user-email') || '').toLowerCase().trim();
  if (!raw || !(raw in USERS)) {
    return res.status(401).json({ error: 'unauthorized', hint: 'set X-User-Email header to a whitelisted address' });
  }
  req.user = USERS[raw];
  next();
}

function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', required: roles });
    }
    next();
  };
}

// ---------- DB pool ------------------------------------------------ //
const pool = new pg.Pool({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

// ---------- Schema auto-provision -------------------------------- //
// Every *.sql file under migrations/ is expected to be idempotent
// (CREATE TABLE IF NOT EXISTS, INSERT WHERE NOT EXISTS, etc.) and
// is re-run on every boot. Keeps a fresh Supabase project in lockstep
// with the code without any manual SQL pasting.
async function ensureSchema() {
  const dir = path.resolve(__dirname, '..', 'migrations');
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir)).filter(n => n.endsWith('.sql')).sort();
  } catch {
    console.warn('[teamscope] no migrations/ dir found, skipping schema bootstrap');
    return;
  }
  for (const name of entries) {
    const sql = await fs.readFile(path.join(dir, name), 'utf8');
    try {
      await pool.query(sql);
      console.log(`[teamscope] applied migration ${name}`);
    } catch (e) {
      console.error(`[teamscope] migration ${name} FAILED:`, (e as Error).message);
      throw e;
    }
  }
}

// ---------- App ---------------------------------------------------- //
const app = express();
app.use(compression());
app.use(express.json({ limit: '12mb' }));

// HSTS so browsers remember to use HTTPS even after a stray HTTP visit.
// Only set when the request reached us over HTTPS (Railway sets x-forwarded-proto).
app.use((req, res, next) => {
  const proto = (req.header('x-forwarded-proto') || '').split(',')[0].trim();
  if (proto === 'https' || NODE_ENV !== 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ---------- Public routes ----------------------------------------- //
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, ts: new Date().toISOString() });
});

app.get('/api/me', (req, res) => {
  const raw = (req.header('x-user-email') || '').toLowerCase().trim();
  if (!raw || !(raw in USERS)) return res.json({ authenticated: false });
  const u = USERS[raw];
  res.json({ authenticated: true, email: u.email, role: u.role });
});

// Config endpoint — useful for the UI to show the roster.
app.get('/api/config/roster', (_req, res) => {
  res.json({
    users: Object.values(USERS).map(u => ({ email: u.email, role: u.role })),
  });
});

// ---------- All routes below require a whitelisted user ----------- //
app.use('/api', (req, res, next) => {
  // already-public routes handled above; everything else goes through auth
  if (
    req.path === '/health' ||
    req.path === '/me' ||
    req.path === '/config/roster' ||
    req.path.startsWith('/public/')
  ) return next();
  return requireUser(req, res, next);
});

// ---------- Report-prompt templates -------------------------------- //
// Three rows keyed by slot; n8n fetches them so its DM prompts aren't
// hardcoded. Shaped as an object so consumers can do `.morning.text`
// without finding-by-slot.
app.get('/api/config/prompt-templates', async (_req, res) => {
  try {
    const rows = await query<{
      slot: string; template_text: string;
      updated_at: string; updated_by: string | null;
    }>(
      `SELECT slot, template_text, updated_at, updated_by
         FROM ops.report_prompt_templates`
    );
    const out: Record<string, { text: string; updated_at: string; updated_by: string | null }> = {};
    for (const r of rows) {
      out[r.slot] = { text: r.template_text, updated_at: r.updated_at, updated_by: r.updated_by };
    }
    res.json({ templates: out });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.patch('/api/config/prompt-templates/:slot',
  requireRole('boss'),
  async (req, res) => {
    const slot = String(req.params.slot);
    if (!['morning', 'midday', 'eod'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be morning|midday|eod' });
    }
    const text = (req.body?.text as string || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    if (text.length > 4000) return res.status(400).json({ error: 'text too long (max 4000)' });
    try {
      const rows = await query(
        `UPDATE ops.report_prompt_templates
            SET template_text = $1, updated_at = now(), updated_by = $2
          WHERE slot = $3
        RETURNING slot, template_text, updated_at, updated_by`,
        [text, req.user!.email, slot]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'slot_not_found' });
      res.json({ template: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Dashboard summary ------------------------------------- //
app.get('/api/dashboard', async (_req, res) => {
  try {
    const [today, pending, recentActions, subs] = await Promise.all([
      query('SELECT * FROM ops.v_today_reports'),
      query(`SELECT correlation_id, kind, status, asked_of, created_at
               FROM ops.pending_actions
              WHERE status IN ('pending','pa_review')
              ORDER BY created_at DESC LIMIT 20`),
      query(`SELECT id, domain, action, executor, outcome, created_at
               FROM ops.actions_log ORDER BY created_at DESC LIMIT 10`),
      query(`SELECT id, name, role, active FROM ops.report_subscribers WHERE active = true`),
    ]);
    res.json({ today, pending, recentActions, subs });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Reports ------------------------------------------------ //
app.get('/api/reports/today', async (_req, res) => {
  try {
    const rows = await query('SELECT * FROM ops.v_today_reports');
    res.json({ reports: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Promise-loop helper: keep ops.report_goal_items in sync with the
// `goals` text on a daily_reports row. Each parsed goal line becomes
// an item indexed by position. Existing items at the same position
// keep their card_id (so a goal that's already been imported as a card
// stays linked through small text edits). Items that no longer have a
// matching position get hard-deleted; unchanged items stay as-is.
async function syncGoalItems(reportId: string, goalsText: string | null) {
  const lines = parseGoalLines(goalsText || '');
  const existing = await query<{ id: string; position: number; text: string }>(
    `SELECT id, position, text FROM ops.report_goal_items
      WHERE report_id = $1 ORDER BY position`,
    [reportId]
  );
  const byPos = new Map(existing.map(e => [e.position, e]));

  // Upsert one row per parsed line.
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const prev = byPos.get(i);
    if (prev) {
      if (prev.text !== text) {
        await query(
          `UPDATE ops.report_goal_items SET text = $1 WHERE id = $2`,
          [text, prev.id]
        );
      }
      byPos.delete(i);
    } else {
      await query(
        `INSERT INTO ops.report_goal_items (report_id, position, text)
         VALUES ($1, $2, $3)
         ON CONFLICT (report_id, position) DO UPDATE SET text = EXCLUDED.text`,
        [reportId, i, text]
      );
    }
  }
  // Anything left in byPos was a position past the new line count → delete.
  for (const stale of byPos.values()) {
    await query(`DELETE FROM ops.report_goal_items WHERE id = $1`, [stale.id]);
  }
}

// Manually create / upsert a daily-report row (boss only). Lets the
// boss log a report when the n8n Telegram collector misses it (e.g.
// the subscriber didn't use Telegram's Reply feature, so the message
// never bound to the open session). UPSERT on (subscriber_id,
// report_date) so the same call works for new days and existing rows.
app.post('/api/reports',
  requireRole('boss'),
  async (req, res) => {
    const b = req.body || {};
    const subscriberId = String(b.subscriber_id || '').trim();
    if (!subscriberId) return res.status(400).json({ error: 'subscriber_id required' });
    const reportDate = (b.report_date as string) || new Date().toISOString().slice(0, 10);
    const fields = ['goals', 'mid_progress', 'mid_issues', 'mid_changes',
                    'eod_completed', 'eod_unfinished', 'eod_hours'] as const;
    // Build column lists for the UPSERT.
    const cols: string[] = ['subscriber_id', 'report_date'];
    const vals: unknown[] = [subscriberId, reportDate];
    const placeholders: string[] = ['$1::uuid', '$2::date'];
    const updates: string[] = [];
    for (const k of fields) {
      if (b[k] !== undefined) {
        vals.push(b[k] === '' ? null : b[k]);
        const p = `$${vals.length}`;
        cols.push(k);
        placeholders.push(p);
        updates.push(`${k} = EXCLUDED.${k}`);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'at least one report field required' });
    }
    try {
      const rows = await query<{ id: string; goals: string | null }>(
        `INSERT INTO ops.daily_reports (${cols.join(', ')}, updated_at)
         VALUES (${placeholders.join(', ')}, now())
         ON CONFLICT (subscriber_id, report_date) DO UPDATE
           SET ${updates.join(', ')}, updated_at = now()
         RETURNING id, subscriber_id, to_char(report_date, 'YYYY-MM-DD') AS report_date,
                   goals, mid_progress, mid_issues, mid_changes,
                   eod_completed, eod_unfinished, eod_hours, updated_at`,
        vals
      );
      // Keep promise tracker in sync with the goals text.
      if (b.goals !== undefined) {
        await syncGoalItems(rows[0].id, rows[0].goals);
      }
      res.json({ report: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Edit a daily-report row (boss only). Accepts any subset of the
// human-authored fields; nulls are allowed to clear a slot. The n8n
// pipeline won't re-overwrite an edited slot within the same day
// unless the subscriber sends a fresh Telegram reply.
app.patch('/api/reports/:id',
  async (req, res) => {
    const id = String(req.params.id);
    // Authorize: boss bypasses; otherwise the requester must be the
    // row's owning subscriber (matched by email) AND the row must be
    // less than 12 hours old.
    if (req.user!.role !== 'boss') {
      const owner = await query<{
        owner_email: string | null; created_at: string;
        age_hours: string;
      }>(
        `SELECT s.email AS owner_email, dr.created_at,
                EXTRACT(EPOCH FROM (now() - dr.created_at)) / 3600 AS age_hours
           FROM ops.daily_reports dr
           JOIN ops.report_subscribers s ON s.id = dr.subscriber_id
          WHERE dr.id = $1::uuid`,
        [id]
      );
      if (owner.length === 0) return res.status(404).json({ error: 'not_found' });
      const o = owner[0];
      const isOwner = o.owner_email
        && o.owner_email.toLowerCase() === req.user!.email.toLowerCase();
      const within12h = Number(o.age_hours) < 12;
      if (!isOwner) {
        return res.status(403).json({ error: 'forbidden', reason: 'not_row_owner' });
      }
      if (!within12h) {
        return res.status(403).json({ error: 'forbidden', reason: 'edit_window_closed_12h' });
      }
    }
    const b = req.body || {};
    const editable = [
      'goals', 'mid_progress', 'mid_issues', 'mid_changes',
      'eod_completed', 'eod_unfinished', 'eod_hours',
    ] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of editable) {
      if (b[k] !== undefined) {
        sets.push(`${k} = $${sets.length + 1}`);
        vals.push(b[k] === '' ? null : b[k]);
      }
    }
    // report_date can also move (e.g. n8n bound a late reply to a stale session).
    if (b.report_date !== undefined) {
      const d = String(b.report_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return res.status(400).json({ error: 'report_date must be YYYY-MM-DD' });
      }
      sets.push(`report_date = $${sets.length + 1}::date`);
      vals.push(d);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    vals.push(id);
    try {
      const rows = await query<{ id: string; goals: string | null }>(
        `UPDATE ops.daily_reports SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${vals.length}
        RETURNING id, subscriber_id, to_char(report_date, 'YYYY-MM-DD') AS report_date,
                  goals, mid_progress, mid_issues, mid_changes,
                  eod_completed, eod_unfinished, eod_hours, updated_at`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      if (b.goals !== undefined) {
        await syncGoalItems(rows[0].id, rows[0].goals);
      }
      res.json({ report: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/reports/:id',
  requireRole('boss'),
  async (req, res) => {
    try {
      const rows = await query(
        `DELETE FROM ops.daily_reports WHERE id = $1
        RETURNING id, subscriber_id, to_char(report_date, 'YYYY-MM-DD') AS report_date`,
        [String(req.params.id)]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.get('/api/reports/recent', async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days ?? 14)));
  try {
    const rows = await query(
      `SELECT d.id, d.subscriber_id, s.name AS subscriber_name, s.role AS subscriber_role,
              s.email AS subscriber_email,
              to_char(d.report_date, 'YYYY-MM-DD') AS report_date,
              d.goals,
              d.mid_progress, d.mid_issues, d.mid_changes,
              d.eod_completed, d.eod_unfinished, d.eod_hours,
              d.created_at, d.updated_at
         FROM ops.daily_reports d
         JOIN ops.report_subscribers s ON s.id = d.subscriber_id
        WHERE d.report_date >= (now() - ($1 || ' days')::interval)::date
        ORDER BY d.report_date DESC, s.name`,
      [String(days)]
    );
    res.json({ reports: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Tasks (pending_actions) ------------------------------- //
app.get('/api/tasks', async (req, res) => {
  const user = req.user!;
  const scope = (req.query.scope as string) || (user.role === 'pa' ? 'mine' : 'all');
  // kind filter — defaults to 'approval' so the n8n master router's
  // 'clarification' rows (transient bot-asks-user-back state) don't
  // clutter the queue. Pass &kind=all to see every kind.
  const kindParam = ((req.query.kind as string) || 'approval').toLowerCase();
  try {
    let sql = `SELECT pa.correlation_id, pa.kind, pa.status, pa.asked_of,
                      pa.created_at, pa.resolved_at, pa.payload,
                      m.text AS origin_text,
                      p.name AS requester_name, p.role AS requester_role
                 FROM ops.pending_actions pa
            LEFT JOIN ops.messages m ON m.id = pa.message_id
            LEFT JOIN ops.profiles p ON p.id = pa.profile_id
                WHERE pa.status IN ('pending','pa_review','in_progress')`;
    if (kindParam !== 'all') sql += ` AND pa.kind = '${kindParam.replace(/'/g, '')}'`;
    if (scope === 'mine' && user.role === 'pa') sql += ` AND pa.asked_of = 'pa'`;
    sql += ` ORDER BY pa.created_at DESC LIMIT 100`;

    const rows = await query(sql);
    res.json({ tasks: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/tasks/:id/claim',
  requireRole('pa', 'boss'),
  async (req, res) => {
    const id = req.params.id;
    try {
      const rows = await query(
        `UPDATE ops.pending_actions
            SET status = 'in_progress', asked_of = 'pa', resolved_at = NULL
          WHERE correlation_id = $1
        RETURNING correlation_id, status, asked_of`,
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ task: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/tasks/:id/complete',
  requireRole('pa', 'boss'),
  async (req, res) => {
    const id = req.params.id;
    const notes = (req.body?.notes as string) || null;
    try {
      const rows = await query(
        `UPDATE ops.pending_actions
            SET status = 'completed', resolved_at = now()
          WHERE correlation_id = $1
        RETURNING correlation_id, status, resolved_at`,
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      // Also record in actions_log for visibility
      await query(
        `INSERT INTO ops.actions_log (correlation_id, profile_id, domain, action, executor, outcome)
         VALUES ($1, (SELECT profile_id FROM ops.pending_actions WHERE correlation_id=$1),
                 'pa_task', 'complete', $2, COALESCE($3, 'success'))`,
        [id, req.user!.role, notes]
      );
      res.json({ task: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/tasks/:id/cancel',
  requireRole('boss'),
  async (req, res) => {
    const id = req.params.id;
    try {
      const rows = await query(
        `UPDATE ops.pending_actions
            SET status = 'cancelled', resolved_at = now()
          WHERE correlation_id = $1
        RETURNING correlation_id, status`,
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ task: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Agent (n8n integration) ------------------------------ //
// n8n exposes `08 · TeamScope Agent Webhook` at N8N_AGENT_URL that takes
// { text, user_email } and returns { classification, action_taken }.
const N8N_AGENT_URL = process.env.N8N_AGENT_URL
  || 'https://pa.stratexai.io/webhook/teamscope-agent';

app.post('/api/agent/message',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const text = (req.body?.text as string || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const upstream = await fetch(N8N_AGENT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          user_email: req.user!.email,
        }),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(502).json({ error: 'agent_upstream_error', detail: data });
      }
      res.json(data);
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.get('/api/agent/actions', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  try {
    const rows = await query(
      `SELECT a.id, a.correlation_id, a.domain, a.action, a.executor,
              a.outcome, a.created_at,
              p.name AS requester_name
         FROM ops.actions_log a
    LEFT JOIN ops.profiles p ON p.id = a.profile_id
        ORDER BY a.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ actions: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.get('/api/agent/classifications', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 30)));
  try {
    const rows = await query(
      `SELECT c.id, c.domain, c.action, c.confidence, c.requires_approval,
              c.assignee, c.priority, c.created_at,
              m.text AS source_text, m.channel
         FROM ops.classifications c
    LEFT JOIN ops.messages m ON m.id = c.message_id
        ORDER BY c.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ classifications: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Team (subscribers / profiles) ------------------------- //
app.get('/api/team', async (_req, res) => {
  try {
    const [subscribers, profiles] = await Promise.all([
      query(`SELECT id, telegram_chat_id, name, role, timezone, email, language, template_set_id,
                    slot_morning, slot_midday, slot_eod, working_days, active, created_at
               FROM ops.report_subscribers ORDER BY active DESC, name`),
      query(`SELECT id, telegram_chat_id, name, role, timezone, active, created_at
               FROM ops.profiles WHERE active = true ORDER BY name`),
    ]);
    res.json({ subscribers, profiles });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/team/subscribers/:id/toggle',
  requireRole('boss'),
  async (req, res) => {
    try {
      const rows = await query(
        `UPDATE ops.report_subscribers SET active = NOT active WHERE id = $1
         RETURNING id, name, active`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ subscriber: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Send a "ping" DM so the boss can verify @edpapabot can reach a
// subscriber's chat_id after editing their schedule. Uses the
// normal sendTelegramMessage helper so retry + no-token handling
// are consistent with card-assignment notifications.
app.post('/api/team/subscribers/:id/test-ping',
  requireRole('boss'),
  async (req, res) => {
    const id = String(req.params.id);
    try {
      const rows = await query<{ name: string; telegram_chat_id: number }>(
        `SELECT name, telegram_chat_id FROM ops.report_subscribers WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      const sub = rows[0];
      const text =
        `🔔 *TeamScope ping*\n\n` +
        `This is a test message from ${req.user!.email.split('@')[0]}. ` +
        `If you see this, @edpapabot can reach you at your current schedule.\n\n` +
        `_No action needed._`;
      const outcome = await sendTelegramMessage(sub.telegram_chat_id, text);
      console.log(`[teamscope] test-ping ${sub.name} → ${outcome} (by ${req.user!.email})`);
      res.json({ outcome, subscriber: { name: sub.name, chat_id: sub.telegram_chat_id } });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Leave / public holidays --------------------------------- //
app.get('/api/team/subscribers/:id/leave',
  requireRole('boss', 'pa'),
  async (req, res) => {
    try {
      const rows = await query(
        `SELECT to_char(leave_date, 'YYYY-MM-DD') AS leave_date, kind, note,
                created_by, created_at
           FROM ops.subscriber_leave_days
          WHERE subscriber_id = $1::uuid
          ORDER BY leave_date DESC`,
        [String(req.params.id)]
      );
      res.json({ leave: rows });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/team/subscribers/:id/leave',
  requireRole('boss'),
  async (req, res) => {
    const date = String(req.body?.leave_date || '');
    const kind = String(req.body?.kind || 'leave');
    const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'leave_date must be YYYY-MM-DD' });
    }
    if (!['leave', 'sick', 'unpaid', 'public_holiday', 'other'].includes(kind)) {
      return res.status(400).json({ error: 'invalid kind' });
    }
    try {
      const rows = await query(
        `INSERT INTO ops.subscriber_leave_days
           (subscriber_id, leave_date, kind, note, created_by)
         VALUES ($1::uuid, $2::date, $3, $4, $5)
         ON CONFLICT (subscriber_id, leave_date) DO UPDATE
           SET kind = EXCLUDED.kind, note = EXCLUDED.note
         RETURNING to_char(leave_date, 'YYYY-MM-DD') AS leave_date, kind, note`,
        [String(req.params.id), date, kind, note, req.user!.email]
      );
      res.json({ leave: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/team/subscribers/:id/leave/:date',
  requireRole('boss'),
  async (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    try {
      const rows = await query(
        `DELETE FROM ops.subscriber_leave_days
          WHERE subscriber_id = $1::uuid AND leave_date = $2::date
        RETURNING to_char(leave_date, 'YYYY-MM-DD') AS leave_date`,
        [String(req.params.id), date]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.get('/api/config/public-holidays', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name, country
         FROM ops.public_holidays ORDER BY holiday_date DESC LIMIT 200`
    );
    res.json({ holidays: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/config/public-holidays',
  requireRole('boss'),
  async (req, res) => {
    const date = String(req.body?.holiday_date || '');
    const name = String(req.body?.name || '').trim();
    const country = String(req.body?.country || 'SG').slice(0, 4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) {
      return res.status(400).json({ error: 'holiday_date + name required' });
    }
    try {
      const rows = await query(
        `INSERT INTO ops.public_holidays (holiday_date, name, country, created_by)
         VALUES ($1::date, $2, $3, $4)
         ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country
         RETURNING to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name, country`,
        [date, name, country, req.user!.email]
      );
      res.json({ holiday: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/config/public-holidays/:date',
  requireRole('boss'),
  async (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    try {
      const rows = await query(
        `DELETE FROM ops.public_holidays WHERE holiday_date = $1::date
        RETURNING to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, name`,
        [date]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Streak / missed-slots / monthly summary ---------------- //
// "Day reported" = date is in subscriber.working_days, not leave/PH,
// and has at least one non-null slot field in daily_reports.
app.get('/api/team/subscribers/:id/streak',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const id = String(req.params.id);
    try {
      const subs = await query<{ working_days: number[] }>(
        `SELECT working_days FROM ops.report_subscribers WHERE id = $1::uuid`, [id]);
      if (subs.length === 0) return res.status(404).json({ error: 'not_found' });
      const wd = subs[0].working_days ?? [1, 2, 3, 4, 5];

      // Streak: walk backwards from today; non-working/leave/PH days are
      // "skip" (don't break streak); a working day with no report breaks it.
      const win = await query<{ dt: string; off: boolean; reported: boolean }>(
        `WITH dates AS (
           SELECT d::date AS dt FROM generate_series((now() - interval '60 days')::date, now()::date, interval '1 day') d
         )
         SELECT to_char(dt, 'YYYY-MM-DD') AS dt,
                (NOT (EXTRACT(isodow FROM dt)::int = ANY($2::int[]))
                 OR EXISTS (SELECT 1 FROM ops.subscriber_leave_days l
                             WHERE l.subscriber_id = $1::uuid AND l.leave_date = dt)
                 OR EXISTS (SELECT 1 FROM ops.public_holidays h
                             WHERE h.holiday_date = dt)) AS off,
                EXISTS (
                  SELECT 1 FROM ops.daily_reports r
                   WHERE r.subscriber_id = $1::uuid AND r.report_date = dt
                     AND (r.goals IS NOT NULL OR r.mid_progress IS NOT NULL
                       OR r.eod_completed IS NOT NULL OR r.eod_unfinished IS NOT NULL
                       OR r.eod_hours IS NOT NULL)
                ) AS reported
           FROM dates ORDER BY dt DESC`,
        [id, wd]
      );
      let current = 0;
      for (const d of win) {
        if (d.off) continue;
        if (d.reported) current++;
        else break;
      }
      // Last 30 days metrics
      const last30 = win.slice(0, 30);
      const missed30 = last30.filter(d => !d.off && !d.reported).length;
      // Longest streak in window
      let longest = 0, run = 0;
      for (const d of [...win].reverse()) {
        if (d.off) continue;
        if (d.reported) { run++; if (run > longest) longest = run; }
        else run = 0;
      }
      res.json({ current, longest_30d: longest, missed_30d: missed30 });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.get('/api/missed-slots',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const dateRaw = String(req.query.date || '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
      ? dateRaw
      : new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    try {
      const rows = await query<{
        id: string; name: string; reported: boolean;
        slot_morning_done: boolean; slot_midday_done: boolean; slot_eod_done: boolean;
        is_off: boolean;
      }>(
        `SELECT s.id, s.name,
                (NOT (EXTRACT(isodow FROM $1::date)::int = ANY(s.working_days))
                 OR EXISTS (SELECT 1 FROM ops.subscriber_leave_days l
                             WHERE l.subscriber_id = s.id AND l.leave_date = $1::date)
                 OR EXISTS (SELECT 1 FROM ops.public_holidays h
                             WHERE h.holiday_date = $1::date)) AS is_off,
                COALESCE(r.goals IS NOT NULL OR r.mid_progress IS NOT NULL OR r.eod_completed IS NOT NULL, false) AS reported,
                COALESCE(r.goals IS NOT NULL, false) AS slot_morning_done,
                COALESCE(r.mid_progress IS NOT NULL, false) AS slot_midday_done,
                COALESCE(r.eod_completed IS NOT NULL OR r.eod_hours IS NOT NULL, false) AS slot_eod_done
           FROM ops.report_subscribers s
      LEFT JOIN ops.daily_reports r ON r.subscriber_id = s.id AND r.report_date = $1::date
          WHERE s.active = true
          ORDER BY s.name`,
        [date]
      );
      const summary = rows.map(r => {
        const missing: string[] = [];
        if (!r.is_off) {
          if (!r.slot_morning_done) missing.push('morning');
          if (!r.slot_midday_done) missing.push('midday');
          if (!r.slot_eod_done) missing.push('eod');
        }
        return {
          subscriber_id: r.id, name: r.name,
          is_off: r.is_off, missing_slots: missing,
          fully_reported: !r.is_off && missing.length === 0,
        };
      });
      res.json({ date, subscribers: summary });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/missed-slots/digest',
  requireRole('boss'),
  async (req, res) => {
    const dateRaw = String(req.body?.date || '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
      ? dateRaw
      : new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    try {
      const rows = await query<{
        name: string; missing: string[]; is_off: boolean;
      }>(
        `SELECT s.name, s.telegram_chat_id, s.working_days,
                ARRAY_REMOVE(ARRAY[
                  CASE WHEN r.goals IS NULL THEN 'morning' END,
                  CASE WHEN r.mid_progress IS NULL THEN 'midday' END,
                  CASE WHEN r.eod_completed IS NULL AND r.eod_hours IS NULL THEN 'eod' END
                ], NULL) AS missing,
                (NOT (EXTRACT(isodow FROM $1::date)::int = ANY(s.working_days))
                 OR EXISTS (SELECT 1 FROM ops.subscriber_leave_days l
                             WHERE l.subscriber_id = s.id AND l.leave_date = $1::date)
                 OR EXISTS (SELECT 1 FROM ops.public_holidays h
                             WHERE h.holiday_date = $1::date)) AS is_off
           FROM ops.report_subscribers s
      LEFT JOIN ops.daily_reports r ON r.subscriber_id = s.id AND r.report_date = $1::date
          WHERE s.active = true
          ORDER BY s.name`,
        [date]
      );
      const lines: string[] = [];
      for (const r of rows) {
        if (r.is_off) continue;
        if (r.missing && r.missing.length > 0) {
          lines.push(`• *${escapeMarkdown(r.name)}* — missed: ${r.missing.join(', ')}`);
        }
      }
      // Find boss chat_id from ALLOWED_USERS or env. Use TELEGRAM_ALLOWED_CHAT_IDS
      // first non-empty value, else fall back to first whitelisted boss.
      const allowedChats = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const bossChatId = allowedChats[0] || '5246139725';
      const text = lines.length === 0
        ? `✅ *${date}* — every active member reported, nothing missed.`
        : `📋 *Missed-slot digest — ${date}*\n\n${lines.join('\n')}`;
      const outcome = await sendTelegramMessage(Number(bossChatId), text);
      res.json({ date, missing_count: lines.length, telegram_outcome: outcome });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/team/subscribers/:id/monthly-summary',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const id = String(req.params.id);
    const monthRaw = (req.query.month as string | undefined)
      || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthRaw)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    const periodStart = `${monthRaw}-01`;
    // last day of month
    const [y, m] = monthRaw.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const periodEnd = `${monthRaw}-${String(lastDay).padStart(2, '0')}`;
    try {
      const subs = await query<{ name: string; role: string | null }>(
        `SELECT name, role FROM ops.report_subscribers WHERE id = $1::uuid`, [id]);
      if (subs.length === 0) return res.status(404).json({ error: 'subscriber_not_found' });
      const sub = subs[0];

      const reports = await query(
        `SELECT to_char(report_date, 'YYYY-MM-DD') AS date,
                goals, mid_progress, mid_issues, mid_changes,
                eod_completed, eod_unfinished, eod_hours
           FROM ops.daily_reports
          WHERE subscriber_id = $1::uuid
            AND report_date BETWEEN $2::date AND $3::date
          ORDER BY report_date`,
        [id, periodStart, periodEnd]
      );
      const cards = await query(
        `SELECT c.title, c.priority, c.done_at IS NOT NULL AS done,
                col.name AS column_name
           FROM ops.kanban_cards c
           JOIN ops.kanban_assignees a ON a.card_id = c.id
      LEFT JOIN ops.kanban_columns col ON col.id = c.column_id
          WHERE a.subscriber_id = $1::uuid
            AND c.deleted_at IS NULL
            AND c.created_at::date BETWEEN $2::date AND $3::date
          ORDER BY c.created_at`,
        [id, periodStart, periodEnd]
      );
      const periodCompute = await computeSalaryPeriod(id, periodStart, periodEnd);

      const system =
        "You are a senior ops manager writing a one-page monthly performance review. " +
        "Plain prose, 4-6 short paragraphs, factual but warm. Cite dates and numbers. " +
        "Cover: hours worked, days reported vs working days, recurring blockers if any, " +
        "what was completed, what was unfinished, anything notable in the data.";
      const userMessage =
        `Subscriber: ${sub.name} (${sub.role ?? 'team'})\n` +
        `Month: ${monthRaw} (${periodStart} – ${periodEnd})\n\n` +
        `Compute: working_days=${periodCompute.working_days_in_period}, ` +
        `days_reported=${periodCompute.days_reported}, days_missed=${periodCompute.days_missed}, ` +
        `hours_reported=${periodCompute.hours_reported}, leave=${periodCompute.leave_days}, ` +
        `public_holidays=${periodCompute.public_holidays}.\n\n` +
        `Daily reports JSON:\n${JSON.stringify(reports, null, 2)}\n\n` +
        `Kanban cards JSON:\n${JSON.stringify(cards, null, 2)}\n\n` +
        `Write the monthly review.`;
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          system,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
      if (!upstream.ok) {
        return res.status(502).json({ error: 'anthropic_error', detail: data });
      }
      const summary =
        (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text
        || '(empty summary)';

      await query(
        `INSERT INTO ops.monthly_summaries
           (subscriber_id, period_start, period_end, summary, generated_by)
         VALUES ($1::uuid, $2::date, $3::date, $4, $5)
         ON CONFLICT (subscriber_id, period_start) DO UPDATE
           SET summary = EXCLUDED.summary,
               generated_at = now(),
               generated_by = EXCLUDED.generated_by`,
        [id, periodStart, periodEnd, summary, req.user!.email]
      );
      res.json({
        subscriber_id: id, month: monthRaw,
        period_start: periodStart, period_end: periodEnd,
        summary, period: periodCompute,
        report_rows: reports.length, card_rows: cards.length,
      });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Salary --------------------------------------------------- //
// Per-subscriber rate config + period compute + payment log.

app.get('/api/team/subscribers/:id/salary',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const id = String(req.params.id);
    try {
      const [config, payments] = await Promise.all([
        query<{ payment_type: string; rate: string; currency: string;
                notes: string | null; updated_at: string; updated_by: string | null }>(
          `SELECT payment_type, rate, currency, notes, updated_at, updated_by
             FROM ops.subscriber_salary WHERE subscriber_id = $1`,
          [id]
        ),
        query(
          `SELECT id, period_start, period_end, days_reported, hours_reported,
                  amount, currency, paid_at, paid_by, notes
             FROM ops.salary_payments
            WHERE subscriber_id = $1
            ORDER BY paid_at DESC LIMIT 5`,
          [id]
        ),
      ]);
      res.json({ config: config[0] ?? null, recent_payments: payments });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.put('/api/team/subscribers/:id/salary',
  requireRole('boss'),
  async (req, res) => {
    const id = String(req.params.id);
    const b = req.body || {};
    const paymentType = String(b.payment_type || '');
    if (!['monthly_base', 'hourly', 'daily_rate'].includes(paymentType)) {
      return res.status(400).json({ error: 'payment_type must be monthly_base|hourly|daily_rate' });
    }
    const rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ error: 'rate must be a non-negative number' });
    }
    const currency = String(b.currency || 'SGD').toUpperCase().slice(0, 8);
    const notes = b.notes ? String(b.notes).slice(0, 500) : null;
    try {
      const rows = await query(
        `INSERT INTO ops.subscriber_salary
           (subscriber_id, payment_type, rate, currency, notes, updated_by, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
         ON CONFLICT (subscriber_id) DO UPDATE
           SET payment_type = EXCLUDED.payment_type,
               rate         = EXCLUDED.rate,
               currency     = EXCLUDED.currency,
               notes        = EXCLUDED.notes,
               updated_by   = EXCLUDED.updated_by,
               updated_at   = now()
         RETURNING subscriber_id, payment_type, rate, currency, notes,
                   updated_at, updated_by`,
        [id, paymentType, rate, currency, notes, req.user!.email]
      );
      res.json({ config: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Compute what's owed for a date window. Re-used by the Member page
// preview and by the Mark Paid flow to suggest an amount.
app.get('/api/salary/period',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const subscriberId = String(req.query.subscriber_id || '').trim();
    const from = String(req.query.from || '').trim();
    const to   = String(req.query.to   || '').trim();
    if (!subscriberId) return res.status(400).json({ error: 'subscriber_id required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    try {
      const summary = await computeSalaryPeriod(subscriberId, from, to);
      res.json(summary);
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.post('/api/team/subscribers/:id/salary/pay',
  requireRole('boss'),
  async (req, res) => {
    const id = String(req.params.id);
    const b = req.body || {};
    const periodStart = String(b.period_start || '');
    const periodEnd   = String(b.period_end || '');
    const amount = Number(b.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return res.status(400).json({ error: 'period_start/period_end must be YYYY-MM-DD' });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'amount must be a non-negative number' });
    }
    const currency = String(b.currency || 'SGD').toUpperCase().slice(0, 8);
    const notes = b.notes ? String(b.notes).slice(0, 500) : null;
    try {
      const summary = await computeSalaryPeriod(id, periodStart, periodEnd);
      const rows = await query(
        `INSERT INTO ops.salary_payments
           (subscriber_id, period_start, period_end,
            days_reported, hours_reported, amount, currency, paid_by, notes)
         VALUES ($1::uuid, $2::date, $3::date, $4, $5, $6, $7, $8, $9)
         RETURNING id, period_start, period_end, days_reported, hours_reported,
                   amount, currency, paid_at, paid_by, notes`,
        [id, periodStart, periodEnd,
         summary.days_reported, summary.hours_reported,
         amount, currency, req.user!.email, notes]
      );
      res.json({ payment: rows[0], computed: summary });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

interface SalaryPeriodSummary {
  subscriber_id: string;
  period_start: string;
  period_end: string;
  config: { payment_type: string; rate: number; currency: string } | null;
  working_days_in_period: number;
  leave_days: number;
  public_holidays: number;
  days_reported: number;
  days_missed: number;
  hours_reported: number;
  amount_owed: number;
  already_paid: number;
  net_due: number;
  currency: string;
}

async function computeSalaryPeriod(subscriberId: string, from: string, to: string): Promise<SalaryPeriodSummary> {
  // Fetch subscriber config + working_days
  const subs = await query<{
    working_days: number[]; payment_type: string | null;
    rate: string | null; currency: string | null;
  }>(
    `SELECT s.working_days,
            sal.payment_type, sal.rate, sal.currency
       FROM ops.report_subscribers s
  LEFT JOIN ops.subscriber_salary sal ON sal.subscriber_id = s.id
      WHERE s.id = $1::uuid`,
    [subscriberId]
  );
  if (subs.length === 0) {
    const err = new Error('subscriber_not_found') as Error & { status: number };
    err.status = 404; throw err;
  }
  const sub = subs[0];
  const workingDays = sub.working_days ?? [1, 2, 3, 4, 5];

  // Working days in window (matches subscriber's working_days),
  // minus subscriber-specific leave AND global public holidays.
  const wdRow = await query<{ n: number; leave_count: number; ph_count: number }>(
    `WITH dates AS (
       SELECT d::date AS dt FROM generate_series($1::date, $2::date, interval '1 day') d
        WHERE EXTRACT(isodow FROM d)::int = ANY($3::int[])
     )
     SELECT COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM ops.subscriber_leave_days l
                 WHERE l.subscriber_id = $4::uuid AND l.leave_date = dates.dt)
                AND NOT EXISTS (
                SELECT 1 FROM ops.public_holidays h
                 WHERE h.holiday_date = dates.dt)
            )::int AS n,
            (SELECT COUNT(*)::int FROM ops.subscriber_leave_days l
              WHERE l.subscriber_id = $4::uuid
                AND l.leave_date BETWEEN $1::date AND $2::date) AS leave_count,
            (SELECT COUNT(*)::int FROM ops.public_holidays h
              WHERE h.holiday_date BETWEEN $1::date AND $2::date) AS ph_count
       FROM dates`,
    [from, to, workingDays, subscriberId]
  );
  const workingDaysInPeriod = wdRow[0]?.n ?? 0;
  const leaveCount = wdRow[0]?.leave_count ?? 0;
  const phCount = wdRow[0]?.ph_count ?? 0;

  // Days the subscriber actually reported (any non-null slot)
  const repRow = await query<{ days_reported: number; hours_reported: string | null }>(
    `SELECT COUNT(*) FILTER (
              WHERE goals IS NOT NULL OR mid_progress IS NOT NULL
                 OR mid_issues IS NOT NULL OR mid_changes IS NOT NULL
                 OR eod_completed IS NOT NULL OR eod_unfinished IS NOT NULL
                 OR eod_hours IS NOT NULL
            )::int AS days_reported,
            COALESCE(SUM(eod_hours), 0)::numeric AS hours_reported
       FROM ops.daily_reports
      WHERE subscriber_id = $1::uuid
        AND report_date BETWEEN $2::date AND $3::date`,
    [subscriberId, from, to]
  );
  const daysReported = repRow[0]?.days_reported ?? 0;
  const hoursReported = Number(repRow[0]?.hours_reported ?? 0);

  // Already paid: sum of payments whose period overlaps [from,to]
  const paidRow = await query<{ paid: string | null }>(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS paid
       FROM ops.salary_payments
      WHERE subscriber_id = $1::uuid
        AND period_start <= $3::date AND period_end >= $2::date`,
    [subscriberId, from, to]
  );
  const alreadyPaid = Number(paidRow[0]?.paid ?? 0);

  const rate = sub.rate ? Number(sub.rate) : 0;
  const currency = sub.currency || 'SGD';
  const paymentType = sub.payment_type;

  let amountOwed = 0;
  if (paymentType === 'monthly_base') {
    // If both endpoints are in the same calendar month and span the
    // full month, treat as full monthly. Otherwise pro-rate by
    // days_reported / max(working_days_in_period, 1).
    const ratio = workingDaysInPeriod > 0
      ? Math.min(1, daysReported / workingDaysInPeriod) : 0;
    amountOwed = Math.round(rate * ratio * 100) / 100;
  } else if (paymentType === 'hourly') {
    amountOwed = Math.round(rate * hoursReported * 100) / 100;
  } else if (paymentType === 'daily_rate') {
    amountOwed = Math.round(rate * daysReported * 100) / 100;
  }
  // Else: no config — amount_owed stays 0.

  return {
    subscriber_id: subscriberId,
    period_start: from,
    period_end: to,
    config: paymentType ? { payment_type: paymentType, rate, currency } : null,
    working_days_in_period: workingDaysInPeriod,
    leave_days: leaveCount,
    public_holidays: phCount,
    days_reported: daysReported,
    days_missed: Math.max(0, workingDaysInPeriod - daysReported),
    hours_reported: hoursReported,
    amount_owed: amountOwed,
    already_paid: alreadyPaid,
    net_due: Math.round((amountOwed - alreadyPaid) * 100) / 100,
    currency,
  };
}

// Update an existing subscriber's editable fields (boss only).
app.patch('/api/team/subscribers/:id',
  requireRole('boss'),
  async (req, res) => {
    const b = req.body || {};
    const allowed = ['name', 'role', 'timezone',
                     'slot_morning', 'slot_midday', 'slot_eod',
                     'working_days', 'active', 'telegram_chat_id',
                     'email', 'language', 'template_set_id'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of allowed) {
      if (b[k] !== undefined) {
        sets.push(`${k} = $${sets.length + 1}`);
        vals.push(b[k]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const rows = await query(
        `UPDATE ops.report_subscribers SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${vals.length}
        RETURNING id, telegram_chat_id, name, role, timezone, language, template_set_id,
                  slot_morning, slot_midday, slot_eod, working_days, active`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ subscriber: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/team/subscribers/:id',
  requireRole('boss'),
  async (req, res) => {
    try {
      const rows = await query(
        `DELETE FROM ops.report_subscribers WHERE id = $1 RETURNING id, name`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Full details for the edit modal — includes last 5 reports + last active.
app.get('/api/team/subscribers/:id',
  async (req, res) => {
    try {
      const [sub, reports] = await Promise.all([
        query(
          `SELECT id, telegram_chat_id, name, role, timezone, email, language, template_set_id,
                  slot_morning, slot_midday, slot_eod, working_days,
                  active, created_at, updated_at
             FROM ops.report_subscribers WHERE id = $1`,
          [req.params.id]
        ),
        query(
          `SELECT report_date, goals, mid_progress, mid_issues,
                  eod_completed, eod_unfinished, eod_hours, updated_at
             FROM ops.daily_reports
            WHERE subscriber_id = $1
            ORDER BY report_date DESC LIMIT 5`,
          [req.params.id]
        ),
      ]);
      if (sub.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ subscriber: sub[0], recent_reports: reports });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Create a new daily-report subscriber so 03 · Report Prompter will DM them
// at the three slot times (morning/midday/eod in their timezone).
app.post('/api/team/subscribers',
  requireRole('boss'),
  async (req, res) => {
    const b = req.body || {};
    const name = (b.name as string || '').trim();
    const telegram = Number(b.telegram_chat_id);
    const role = (b.role as string || 'colleague').trim();
    const tz = (b.timezone as string || 'Asia/Singapore').trim();
    if (!name || !telegram) {
      return res.status(400).json({ error: 'name + telegram_chat_id required' });
    }
    try {
      const rows = await query(
        `INSERT INTO ops.report_subscribers
           (telegram_chat_id, name, role, timezone)
         VALUES ($1::bigint, $2, $3, $4)
         ON CONFLICT (telegram_chat_id)
           DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
                         timezone = EXCLUDED.timezone, active = true,
                         updated_at = now()
         RETURNING id, telegram_chat_id, name, role, timezone,
                   slot_morning, slot_midday, slot_eod, active`,
        [telegram, name, role, tz]
      );
      res.json({ subscriber: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// AI-generated summary of today's reports. Calls Anthropic directly with
// a dedicated summarizer prompt — does NOT go through the router (which
// would flag the structured request as a potential prompt injection).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Classify an incoming Telegram reply into report / task / chatter so
// n8n's 03 · Report Prompter can (a) confirm a clean summary before
// storing, or (b) hand off tasks to the existing agent pipeline.
// Same Anthropic direct-call pattern as /api/agent/summary for the
// same injection-avoidance reason.
const REPORT_SLOTS = ['morning', 'midday', 'eod'] as const;
type ReportSlot = typeof REPORT_SLOTS[number];

app.post('/api/agent/classify-report', async (req, res) => {
  const textRaw = (req.body?.text as string | undefined) || '';
  const slotRaw = (req.body?.slot as string | undefined) || '';
  const subscriberName = (req.body?.subscriber_name as string | undefined) || 'Teammate';
  if (!textRaw.trim()) return res.status(400).json({ error: 'text required' });
  if (!(REPORT_SLOTS as readonly string[]).includes(slotRaw)) {
    return res.status(400).json({ error: 'slot must be morning|midday|eod' });
  }
  const slot = slotRaw as ReportSlot;
  const text = textRaw.trim().slice(0, 2000);

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    // Pull the prompt template so the classifier knows what the bot asked.
    const tplRows = await query<{ template_text: string }>(
      `SELECT template_text FROM ops.report_prompt_templates WHERE slot = $1`,
      [slot]
    );
    const botPrompt = tplRows[0]?.template_text
      || `(template missing for slot=${slot})`;

    const slotFields: Record<ReportSlot, string> = {
      morning: '{"hours": number|null, "goals": string[]}',
      midday:  '{"completed": string|null, "blockers": string|null, "plan_change": string|null}',
      eod:     '{"hours": number|null, "completed": string[]|null, "unfinished": string[]|null}',
    };

    const system =
      "You are a message classifier for a Telegram bot that collects daily work reports. " +
      "The bot asks its subscribers a question at each slot (morning/midday/eod). " +
      "Your job: read the subscriber's reply and classify it.\n\n" +
      "LANGUAGE RULE — CRITICAL:\n" +
      "Subscribers may reply in Chinese (traditional or simplified), English, or mixed. " +
      "You MUST translate every text value in the output (summary, all string fields inside " +
      "structured, and any suggested_task strings) into natural English. Preserve names, " +
      "URLs, identifiers, and code verbatim. Do not add explanatory notes.\n\n" +
      "Possible kinds:\n" +
      "- report_goals: subscriber giving their morning plan (hours, goals)\n" +
      "- report_progress: subscriber giving midday progress (what's done, blockers)\n" +
      "- report_eod: subscriber giving end-of-day summary (hours, completed, unfinished)\n" +
      "- task: subscriber is giving an instruction or delegation, not reporting their own work\n" +
      "- chatter: small talk, confusion, unrelated text, or empty/nonsense\n\n" +
      "Output STRICT JSON only (no prose, no markdown fences) matching this shape:\n" +
      '{\n' +
      '  "kind": "report_goals" | "report_progress" | "report_eod" | "task" | "chatter",\n' +
      '  "confidence": <float 0.0 - 1.0>,\n' +
      '  "summary": "<one short ENGLISH line, max 160 chars, plain prose>",\n' +
      `  "structured": ${slotFields[slot]},  // all string values in English\n` +
      '  "suggested_task": { "title": "<short ENGLISH>", "details": "<one-line ENGLISH>" }  // ONLY when kind==="task"; omit otherwise\n' +
      '}\n';

    const userMessage =
      `Slot: ${slot}\n` +
      `Subscriber: ${subscriberName}\n\n` +
      `The bot asked:\n---\n${botPrompt}\n---\n\n` +
      `Their reply:\n---\n${text}\n---\n\n` +
      `Classify per the rules.`;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
    if (!upstream.ok) {
      return res.status(502).json({ error: 'anthropic_error', detail: data });
    }
    const raw = (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '';
    const parsed = extractJson(raw);
    if (!parsed) {
      return res.status(200).json({
        kind: 'chatter',
        confidence: 0,
        summary: text.slice(0, 160),
        structured: {},
        parse_error: 'claude returned non-JSON',
        raw_preview: raw.slice(0, 200),
      });
    }
    res.json(parsed);
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Canonical message-routing endpoint. Reads any Telegram-style message,
// returns a single intent + a concrete action the caller can execute
// directly. n8n should call this on every inbound DM; the web Agent
// page uses it to power its Smart Router panel.
app.post('/api/agent/route-message', async (req, res) => {
  try {
    const out = await routeMessage(req.body);
    res.json(out);
  } catch (e) {
    const status = (e as { status?: number })?.status ?? pgErrorStatus(e);
    res.status(status).json({ error: (e as Error).message });
  }
});

// Legacy shape — kept so n8n's existing wiring keeps working until
// migrated. Maps the new router output to the older flat schema.
// Prefer /api/agent/route-message in any new integration.
app.post('/api/agent/triage-message', async (req, res) => {
  try {
    const r = await routeMessage(req.body);
    const intent = r.intent;
    const kind: string =
      intent === 'delegate'      ? 'task_for_member' :
      intent === 'plan_self'     ? 'self_plan'       :
      intent === 'report_self'   ? 'report_slot'     :
      intent === 'ambiguous'     ? 'question'        :
      intent === 'status_query'  ? 'question'        :
      intent === 'answer'        ? 'question'        :
                                   'chatter';
    const out: Record<string, unknown> = {
      kind, confidence: r.confidence, summary: r.summary,
    };
    if (r.action?.type === 'create_kanban_card') {
      out.task_for_member = {
        assignee_name: r.action.assignee_name ?? null,
        title: r.action.title,
        details: r.action.description ?? '',
      };
    } else if (r.action?.type === 'create_kanban_cards') {
      out.self_plan = { goals: r.action.cards.map(c => c.title) };
    }
    res.json(out);
  } catch (e) {
    const status = (e as { status?: number })?.status ?? pgErrorStatus(e);
    res.status(status).json({ error: (e as Error).message });
  }
});

// ---------- Shared router implementation --------------------------- //
type RouteAction =
  | { type: 'create_kanban_card'; title: string; description?: string;
      assignee_name?: string | null; priority?: string; due_date?: string | null }
  | { type: 'create_kanban_cards'; cards: Array<{
      title: string; description?: string;
      assignee_name?: string | null; priority?: string; due_date?: string | null;
    }> }
  | { type: 'log_report'; slot: 'morning' | 'midday' | 'eod';
      field: 'goals' | 'mid_progress' | 'eod_completed' | 'eod_unfinished';
      value: string }
  | { type: 'create_research_task'; title: string; brief: string };

interface RouteResult {
  intent: 'answer' | 'report_self' | 'plan_self' | 'delegate'
        | 'research' | 'status_query' | 'chatter' | 'ambiguous';
  confidence: number;
  summary: string;
  reply: string;
  action: RouteAction | null;
  parse_error?: string;
  raw_preview?: string;
}

async function routeMessage(body: Record<string, unknown> | undefined): Promise<RouteResult> {
  const text = String((body?.text as string) || '').trim().slice(0, 2000);
  const senderName = String((body?.sender_name as string) || '').trim().slice(0, 80);
  const senderRole = String((body?.sender_role as string) || '').trim().slice(0, 40);
  if (!text) {
    const err = new Error('text required') as Error & { status: number };
    err.status = 400;
    throw err;
  }
  if (!ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY not configured') as Error & { status: number };
    err.status = 503;
    throw err;
  }

  // Pull live context: subscribers (for delegate matches) and the three
  // current slot prompts (so report_self vs plan_self is judgeable).
  const [subs, tpls] = await Promise.all([
    query<{ name: string }>(
      `SELECT name FROM ops.report_subscribers WHERE active = true ORDER BY name`
    ),
    query<{ slot: string; template_text: string }>(
      `SELECT slot, template_text FROM ops.report_prompt_templates`
    ),
  ]);
  const subsList = subs.map(s => `- ${s.name}`).join('\n') || '(none)';
  const tplBySlot: Record<string, string> = {};
  for (const t of tpls) tplBySlot[t.slot] = t.template_text;
  const today = new Date().toISOString().slice(0, 10);

  const system =
    "You are the intent router for a personal-ops Telegram bot. Read one message and pick a single intent " +
    "from the list, then return STRICT JSON only — no prose, no fences.\n\n" +
    "Intents:\n" +
    "- answer: sender is asking a factual question the bot should answer with text (no record needed).\n" +
    "- report_self: sender is filing daily-report content for themselves (hours worked, what got done, blockers).\n" +
    "- plan_self: sender is listing THEIR OWN goals/todos for the day. Each item becomes a card.\n" +
    "- delegate: sender wants a named team member to do something. Must be able to match a name from the list.\n" +
    "- research: sender wants deep work / a research task done (often phrased 'find X', 'research Y'). Surface as a research task; don't attempt to execute.\n" +
    "- status_query: sender is asking about the state of something tracked (a card, a member's progress, recent reports).\n" +
    "- chatter: small talk, reactions, fragments, ack messages.\n" +
    "- ambiguous: not enough info to act — bot should reply asking for clarification.\n\n" +
    "Output schema:\n" +
    '{\n' +
    '  "intent": "<one of the above>",\n' +
    '  "confidence": <float 0..1>,\n' +
    '  "summary": "<one short line>",\n' +
    '  "reply": "<what the bot should DM back to the sender — keep under 240 chars, plain prose>",\n' +
    '  "action": <object or null>\n' +
    '}\n\n' +
    "Action shapes (exactly one or null; omit when not applicable):\n" +
    '- { "type": "create_kanban_card", "title": "<imperative>", "description": "<optional>", "assignee_name": "<from allowed list or null>", "priority": "low|medium|high|urgent", "due_date": "<YYYY-MM-DD or null>" }\n' +
    '- { "type": "create_kanban_cards", "cards": [<the same card shape>, ...] }   // for plan_self when multiple goals were listed\n' +
    '- { "type": "log_report", "slot": "morning|midday|eod", "field": "goals|mid_progress|eod_completed|eod_unfinished", "value": "<cleaned text>" }\n' +
    '- { "type": "create_research_task", "title": "RESEARCH: <topic>", "brief": "<one-line scope>" }\n' +
    '- null  (for answer/chatter/ambiguous/status_query)\n\n' +
    "Rules:\n" +
    "- assignee_name MUST be one of the allowed names below, verbatim. First-name mention is enough if unambiguous. If no name in the message, set null.\n" +
    `- today is ${today} (UTC). Resolve relative dates like 'tomorrow', 'Friday', 'next week' to YYYY-MM-DD.\n` +
    "- For report_self pick the slot by content: hours/done/unfinished → eod; what's-done-since-morning → midday; goals/plan → morning. Field maps: goals→morning, mid_progress→midday, eod_completed→eod (or eod_unfinished if framed as 'unfinished').\n" +
    "- plan_self vs report_self: if the message lists tasks they intend to do today, prefer plan_self (creates board cards). Use report_self only when it reads like a status update against today's work.\n" +
    "- Be conservative — if the message could be either delegate or chatter, prefer chatter.\n\n" +
    "Allowed assignee names:\n" + subsList + "\n\n" +
    "Current bot slot prompts (for context — DO NOT echo them):\n" +
    `MORNING: ${(tplBySlot.morning || '(default)').slice(0, 200)}\n` +
    `MIDDAY:  ${(tplBySlot.midday  || '(default)').slice(0, 200)}\n` +
    `EOD:     ${(tplBySlot.eod     || '(default)').slice(0, 200)}`;

  const userMessage =
    `Sender: ${senderName || 'unknown'}${senderRole ? ` (${senderRole})` : ''}\n\nMessage:\n${text}`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
  if (!upstream.ok) {
    const err = new Error('anthropic_error: ' + JSON.stringify(data).slice(0, 200)) as Error & { status: number };
    err.status = 502;
    throw err;
  }
  const raw = (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '';
  const parsed = extractJson(raw) as Partial<RouteResult> | null;
  if (!parsed || !parsed.intent) {
    return {
      intent: 'chatter', confidence: 0,
      summary: text.slice(0, 160),
      reply: 'Got it.',
      action: null,
      parse_error: 'claude returned non-JSON',
      raw_preview: raw.slice(0, 200),
    };
  }
  return {
    intent: parsed.intent,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    summary: parsed.summary || text.slice(0, 160),
    reply: parsed.reply || 'Got it.',
    action: (parsed.action ?? null) as RouteAction | null,
  };
}

// Boss-only retroactive cleanup of the AI-classified queue.
// Phase 1: cancel anything with no origin_text (media/forwards/system msgs).
// Phase 2: ask Claude in ONE batched call to label the remaining text-bearing
// pending rows; auto-cancel chatter/question, surface self_plan rows for
// review, leave real tasks alone.
app.post('/api/tasks/cleanup',
  requireRole('boss'),
  async (req, res) => {
    try {
      // ---------- Phase 1: empties ---------- //
      // Catches three shapes: pa.message_id NULL, m.text NULL, or m.text whitespace-only.
      const emptied = await query<{ correlation_id: string; profile_id: string | null }>(
        `UPDATE ops.pending_actions pa
            SET status = 'cancelled', resolved_at = now()
           FROM (
             SELECT pa2.correlation_id
               FROM ops.pending_actions pa2
          LEFT JOIN ops.messages m ON m.id = pa2.message_id
              WHERE pa2.status IN ('pending', 'pa_review')
                AND (m.text IS NULL OR length(trim(m.text)) = 0)
           ) victims
          WHERE pa.correlation_id = victims.correlation_id
        RETURNING pa.correlation_id, pa.profile_id`
      );
      for (const row of emptied) {
        await query(
          `INSERT INTO ops.actions_log
             (correlation_id, profile_id, domain, action, executor, outcome)
           VALUES ($1, $2, 'queue', 'auto_cancel_empty', $3, 'cancelled')`,
          [row.correlation_id, row.profile_id, req.user!.role]
        ).catch(() => {/* log is best-effort */});
      }

      // ---------- Phase 2: triage with Claude ---------- //
      const candidates = await query<{
        correlation_id: string; profile_id: string | null;
        origin_text: string;
      }>(
        `SELECT pa.correlation_id, pa.profile_id, m.text AS origin_text
           FROM ops.pending_actions pa
           JOIN ops.messages m ON m.id = pa.message_id
          WHERE pa.status IN ('pending', 'pa_review')
            AND m.text IS NOT NULL AND length(trim(m.text)) > 0
          ORDER BY pa.created_at DESC
          LIMIT 60`
      );

      let chatterCancelled = 0;
      const selfPlans: Array<{ correlation_id: string; origin_text: string; summary: string }> = [];
      let kept = 0;

      if (candidates.length > 0 && ANTHROPIC_API_KEY) {
        // One batched call so we don't hammer Anthropic.
        const numbered = candidates
          .map((c, i) => `${i + 1}. ${c.origin_text.replace(/\s+/g, ' ').slice(0, 200)}`)
          .join('\n');

        const system =
          "You label messages from a Telegram personal-ops bot's queue. " +
          "Each line is one message numbered 1..N. Output STRICT JSON ONLY:\n" +
          '{ "items": [ { "n": <int>, "kind": "task" | "self_plan" | "chatter" | "question", "summary": "<short>" }, ... ] }\n\n' +
          "Definitions:\n" +
          "- task: a real instruction directed at someone other than the sender.\n" +
          "- self_plan: the sender is describing their OWN day/work/todos.\n" +
          "- question: a clarifying question to the bot.\n" +
          "- chatter: small talk, reactions, fragments, or anything not actionable.\n\n" +
          "Be strict — favour 'chatter' for ambiguous fragments like 'send to Ed 2', 'what is it', 'yes', 'ok'. " +
          "Output one entry per input line, in input order.";

        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': ANTHROPIC_API_KEY,
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1500,
            system,
            messages: [{ role: 'user', content: numbered }],
          }),
        });
        const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
        const raw = (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '';
        const parsed = extractJson(raw) as { items?: Array<{ n: number; kind: string; summary: string }> } | null;
        const items = parsed?.items ?? [];

        for (const item of items) {
          const idx = (item.n | 0) - 1;
          if (idx < 0 || idx >= candidates.length) continue;
          const cand = candidates[idx];
          if (item.kind === 'chatter' || item.kind === 'question') {
            await query(
              `UPDATE ops.pending_actions
                  SET status = 'cancelled', resolved_at = now()
                WHERE correlation_id = $1`,
              [cand.correlation_id]
            );
            await query(
              `INSERT INTO ops.actions_log
                 (correlation_id, profile_id, domain, action, executor, outcome)
               VALUES ($1, $2, 'queue', 'auto_cancel_chatter', $3, $4)`,
              [cand.correlation_id, cand.profile_id, req.user!.role, item.kind]
            ).catch(() => {});
            chatterCancelled++;
          } else if (item.kind === 'self_plan') {
            selfPlans.push({
              correlation_id: cand.correlation_id,
              origin_text: cand.origin_text,
              summary: item.summary || cand.origin_text.slice(0, 120),
            });
            kept++;
          } else {
            kept++;
          }
        }
      } else {
        kept = candidates.length;
      }

      res.json({
        empty_cancelled: emptied.length,
        chatter_cancelled: chatterCancelled,
        kept,
        self_plans: selfPlans,
      });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Turn freeform text ("tell Andrea to prepare slides by Friday") into
// a Kanban card. Claude extracts {title, description, assignee_name,
// priority, due_date}, we match assignee_name to an active subscriber
// (case-insensitive, first-name-ok), then insert. Intended for the AI
// Agent "Send to Board" panel AND for n8n to call when a Telegram
// message should skip the classification queue and land straight on
// the board.
app.post('/api/agent/create-card', async (req, res) => {
  const text = ((req.body?.text as string) || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'text required' });
  const columnOverride = req.body?.column_id as string | undefined;
  const assigneeOverride = req.body?.assignee_id as string | undefined;
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const subs = await query<{ id: string; name: string; active: boolean }>(
      `SELECT id, name, active FROM ops.report_subscribers WHERE active = true`
    );
    const subsList = subs.map(s => `- ${s.name}`).join('\n') || '(none yet)';

    const system =
      "You extract a Kanban card from freeform text. Output STRICT JSON only " +
      "(no prose, no code fences):\n" +
      '{\n' +
      '  "title": "<short imperative, <80 chars>",\n' +
      '  "description": "<optional 1-2 sentences of detail, or null>",\n' +
      '  "assignee_name": "<exact name from the allowed list, or null>",\n' +
      '  "priority": "low" | "medium" | "high" | "urgent",\n' +
      '  "due_date": "<YYYY-MM-DD or null>"\n' +
      '}\n\n' +
      "Rules:\n" +
      "- title: always fill. Rewrite the ask as a clear action, not a quote.\n" +
      "- assignee_name: must match one of the allowed names verbatim (case matters in the output). " +
      "First-name mention counts as a match if it's unambiguous. If the text doesn't name a person, return null.\n" +
      "- priority: 'urgent' only if the text explicitly says so (urgent/asap/critical). Otherwise 'medium'.\n" +
      "- due_date: resolve relative dates (today/tomorrow/Friday) to an absolute YYYY-MM-DD; " +
      `today is ${new Date().toISOString().slice(0, 10)} (UTC). null if unspecified.\n\n` +
      "Allowed assignee names:\n" + subsList;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: text }],
      }),
    });
    const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
    if (!upstream.ok) {
      return res.status(502).json({ error: 'anthropic_error', detail: data });
    }
    const raw = (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '';
    const parsed = extractJson(raw) as {
      title?: string; description?: string | null;
      assignee_name?: string | null;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      due_date?: string | null;
    } | null;
    if (!parsed || !parsed.title) {
      return res.status(502).json({ error: 'claude_parse_failed', raw_preview: raw.slice(0, 200) });
    }

    // Resolve assignee: explicit override wins, else match Claude's name.
    let assigneeId: string | null = assigneeOverride || null;
    if (!assigneeId && parsed.assignee_name) {
      const wanted = parsed.assignee_name.trim().toLowerCase();
      const match = subs.find(s => s.name.trim().toLowerCase() === wanted)
        || subs.find(s => s.name.trim().toLowerCase().split(/\s+/)[0] === wanted.split(/\s+/)[0]);
      if (match) assigneeId = match.id;
    }

    // Resolve target column (default: "Today", else first non-done).
    let columnId = columnOverride;
    if (!columnId) {
      const cols = await query<{ id: string }>(
        `SELECT id FROM ops.kanban_columns
          WHERE deleted_at IS NULL
          ORDER BY CASE WHEN lower(name) = 'today' THEN 0
                        WHEN is_done THEN 2 ELSE 1 END,
                   position LIMIT 1`
      );
      columnId = cols[0]?.id;
    }
    if (!columnId) return res.status(400).json({ error: 'no_target_column' });

    const client = await pool.connect();
    let cardOut: Record<string, unknown>;
    try {
      await client.query('BEGIN');
      const posRow = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_cards
          WHERE column_id = $1 AND deleted_at IS NULL`,
        [columnId]
      );
      const priority = ['low', 'medium', 'high', 'urgent'].includes(parsed.priority as string)
        ? parsed.priority : 'medium';
      const cardRow = await client.query(
        `INSERT INTO ops.kanban_cards
           (column_id, title, description, priority, position, due_date,
            created_by, source_kind, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'agent', $8)
         RETURNING id, column_id, title, description, priority, position,
                   due_date, created_by, created_at, source_kind, source_ref`,
        [columnId, parsed.title.slice(0, 200),
         parsed.description || null, priority,
         posRow.rows[0].next_pos, parsed.due_date || null,
         req.user!.email, `agent:${Date.now()}`]
      );
      cardOut = cardRow.rows[0];
      if (assigneeId) {
        await client.query(
          `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [cardOut.id, assigneeId, req.user!.email]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await logActivity(req.user!.email, cardOut.id as string, 'card.created', {
      title: cardOut.title, column_id: columnId,
      assignees: assigneeId ? [assigneeId] : [],
      source_kind: 'agent', source_text: text.slice(0, 200),
    });
    if (assigneeId) {
      notifyAssignment([assigneeId],
        { id: cardOut.id as string, title: cardOut.title as string },
        req.user!.email);
    }

    res.json({
      card: cardOut,
      parsed: {
        title: parsed.title,
        description: parsed.description ?? null,
        assignee_name: parsed.assignee_name ?? null,
        assignee_id: assigneeId,
        priority: cardOut.priority,
        due_date: cardOut.due_date,
      },
    });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Upload to Cloudflare Images so the bytes survive past the Telegram
// retention window. Returns the public imagedelivery.net URL. All env
// vars are optional — when any are missing this returns null and the
// caller just omits image_url.
async function uploadToCloudflareImages(
  buffer: Buffer, mediaType: string, fileName = 'upload.jpg'
): Promise<string | null> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CF_IMAGES_TOKEN || !CF_IMAGES_ACCOUNT_HASH) {
    return null;
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mediaType }), fileName);
    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${CF_IMAGES_TOKEN}` },
        body: form,
      }
    );
    const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
    if (!upstream.ok) {
      console.error('[teamscope] cf-images upload failed:', upstream.status,
        JSON.stringify(data).slice(0, 200));
      return null;
    }
    const id = (data as { result?: { id?: string } })?.result?.id;
    if (!id) {
      console.error('[teamscope] cf-images: no id in response');
      return null;
    }
    return `https://imagedelivery.net/${CF_IMAGES_ACCOUNT_HASH}/${id}/public`;
  } catch (e) {
    console.error('[teamscope] cf-images upload error:', (e as Error).message);
    return null;
  }
}

// Cap card image attachments at a sensible number and only accept
// trusted Cloudflare Images URLs. Any other input becomes an empty
// array — the upload endpoint is the only legitimate source.
function sanitizeImageUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    if (!v.startsWith('https://imagedelivery.net/')) continue;
    if (v.length > 400) continue;
    out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

// Thin upload endpoint for the web UI: accept a base64 data URL or a
// raw base64 + media_type, push to Cloudflare Images, return the public
// URL. Used by the Board's NewCard / EditCard image drop-zone (drag,
// paste, or file picker — all funnel here). Auth: any whitelisted user.
app.post('/api/uploads/image', async (req, res) => {
  const b = req.body || {};
  let base64 = (b.base64 as string | undefined) || '';
  let mediaType = (b.media_type as string | undefined) || 'image/jpeg';
  const fileName = (b.filename as string | undefined) || 'upload';

  // Accept full data URLs ("data:image/png;base64,...") for convenience.
  const dataUrl = b.data_url as string | undefined;
  if (dataUrl && dataUrl.startsWith('data:')) {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'malformed_data_url' });
    mediaType = m[1];
    base64 = m[2];
  }
  if (!base64) return res.status(400).json({ error: 'base64_or_data_url_required' });
  if (!mediaType.startsWith('image/')) {
    return res.status(400).json({ error: 'media_type_must_be_image' });
  }

  let buf: Buffer;
  try { buf = Buffer.from(base64, 'base64'); }
  catch { return res.status(400).json({ error: 'invalid_base64' }); }
  if (buf.length === 0) return res.status(400).json({ error: 'empty' });
  if (buf.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'image_too_large', max_bytes: 8 * 1024 * 1024 });
  }

  const url = await uploadToCloudflareImages(buf, mediaType, fileName);
  if (!url) return res.status(503).json({ error: 'cf_images_unavailable' });
  res.json({ url });
});

// Vision analysis via Gemini 2.5 Flash. Returns the raw text Claude/Gemini
// emitted; caller is responsible for JSON-extracting if a structured
// response was requested.
async function analyzeImageWithGemini(
  base64: string, mediaType: string,
  systemPrompt: string, userText: string
): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            parts: [
              { inline_data: { mime_type: mediaType, data: base64 } },
              { text: userText },
            ],
          }],
        }),
      }
    );
    const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
    if (!upstream.ok) {
      console.error('[teamscope] gemini error:', upstream.status,
        JSON.stringify(data).slice(0, 300));
      return null;
    }
    const parts = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      ?.candidates?.[0]?.content?.parts;
    return parts?.[0]?.text || null;
  } catch (e) {
    console.error('[teamscope] gemini call failed:', (e as Error).message);
    return null;
  }
}

// Read an image and route it just like a text message — same intent
// taxonomy, same action shapes. Used by n8n when a Telegram photo
// arrives, and by the Agent page test panel. Accepts whichever input
// form the caller has cheapest: a Telegram file_id, a URL, or a raw
// base64 blob. Vision goes through Gemini 2.5 Flash; the bytes are
// also uploaded to Cloudflare Images so the link is permanent.
app.post('/api/agent/analyze-image', async (req, res) => {
  const b = req.body || {};
  const fileId   = (b.telegram_file_id as string | undefined)?.trim();
  const url      = (b.url as string | undefined)?.trim();
  const b64In    = (b.base64 as string | undefined)?.trim();
  const captionRaw = ((b.caption as string | undefined) || '').trim().slice(0, 1000);
  const senderName = ((b.sender_name as string | undefined) || '').trim().slice(0, 80);
  if (!fileId && !url && !b64In) {
    return res.status(400).json({ error: 'one of telegram_file_id, url, base64 required' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    let base64: string;
    let buffer: Buffer;
    let mediaType: string = (b.media_type as string | undefined) || 'image/jpeg';

    if (fileId) {
      if (!TELEGRAM_BOT_TOKEN) {
        return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN required for telegram_file_id' });
      }
      const meta = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
      ).then(r => r.json() as Promise<{ ok: boolean; result?: { file_path?: string }; description?: string }>);
      if (!meta.ok || !meta.result?.file_path) {
        return res.status(502).json({ error: 'telegram_getfile_failed', detail: meta.description || meta });
      }
      const file = await fetch(
        `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`
      );
      if (!file.ok) return res.status(502).json({ error: 'telegram_download_failed', status: file.status });
      buffer = Buffer.from(await file.arrayBuffer());
      base64 = buffer.toString('base64');
      mediaType = file.headers.get('content-type') || guessMediaType(meta.result.file_path) || 'image/jpeg';
    } else if (url) {
      const f = await fetch(url);
      if (!f.ok) return res.status(502).json({ error: 'url_fetch_failed', status: f.status });
      buffer = Buffer.from(await f.arrayBuffer());
      base64 = buffer.toString('base64');
      mediaType = f.headers.get('content-type') || guessMediaType(url) || 'image/jpeg';
      mediaType = mediaType.split(';')[0].trim();
    } else {
      base64 = b64In!;
      buffer = Buffer.from(base64, 'base64');
    }
    // Cap payload at ~5MB raw / 7M base64 chars.
    if (base64.length > 7_500_000) {
      return res.status(413).json({ error: 'image_too_large' });
    }

    const subs = await query<{ name: string }>(
      `SELECT name FROM ops.report_subscribers WHERE active = true ORDER BY name`
    );
    const subsList = subs.map(s => `- ${s.name}`).join('\n') || '(none)';
    const today = new Date().toISOString().slice(0, 10);

    const system =
      "You are the image-aware intent router for a personal-ops Telegram bot. " +
      "The user just sent an image (with optional caption). Look at the image " +
      "and decide what to do, using the same intent taxonomy as the text router. " +
      "Output STRICT JSON only:\n" +
      '{\n' +
      '  "description": "<3-6 sentences describing what is in the image>",\n' +
      '  "intent": "answer" | "report_self" | "plan_self" | "delegate" | "research" | "receipt" | "context_attach" | "chatter" | "ambiguous",\n' +
      '  "confidence": 0..1,\n' +
      '  "summary": "<one short line>",\n' +
      '  "reply": "<what the bot should DM back, under 240 chars>",\n' +
      '  "action": <one of the typed actions below, or null>\n' +
      '}\n\n' +
      "Action shapes:\n" +
      '- { "type": "create_kanban_card", "title": "<imperative>", "description": "<image summary + caption>", "assignee_name": "<from list or null>", "priority": "low|medium|high|urgent", "due_date": "<YYYY-MM-DD or null>" }\n' +
      '- { "type": "create_kanban_cards", "cards": [<the same card shape>, ...] }\n' +
      '- { "type": "log_report", "slot": "morning|midday|eod", "field": "goals|mid_progress|eod_completed|eod_unfinished", "value": "<cleaned text>" }\n' +
      '- { "type": "create_research_task", "title": "RESEARCH: <topic>", "brief": "<one-line scope>" }\n' +
      '- { "type": "create_finance_task", "vendor": "<merchant>", "amount": <number>, "currency": "<3-letter>", "date": "<YYYY-MM-DD or null>", "category": "<short>" }\n' +
      '- null (for answer/chatter/ambiguous/context_attach)\n\n' +
      "Rules:\n" +
      "- 'receipt' = an actual receipt or invoice photo. Extract vendor, amount, currency, date " +
      "from the visible text. Use create_finance_task. If multiple amounts, pick the GRAND TOTAL.\n" +
      "- 'context_attach' is reference imagery (screenshots, mood boards, hairstyle samples) — " +
      "  set action to null; boss attaches manually.\n" +
      "- A whiteboard / meeting notes → plan_self (one card per action item).\n" +
      "- A photo of a thing-to-buy → delegate to PA if the caption implies action; otherwise context_attach.\n" +
      "- assignee_name MUST be one of the allowed names verbatim. First-name match counts.\n" +
      `- today is ${today} (UTC). Resolve relative dates.\n` +
      "Allowed assignee names:\n" + subsList;

    const captionLine = captionRaw
      ? `\n\nUser's caption: "${captionRaw}"`
      : '\n\n(No caption attached.)';
    const senderLine = senderName ? `Sender: ${senderName}` : 'Sender: unknown';
    const userText = `${senderLine}${captionLine}\n\nWhat should the bot do with this image?`;

    // Vision + CF upload run in parallel — the upload is best-effort
    // (image_url stays null on failure) so we don't gate the response
    // on its success.
    const [rawText, imageUrl] = await Promise.all([
      analyzeImageWithGemini(base64, mediaType, system, userText),
      uploadToCloudflareImages(buffer, mediaType, fileId ? `${fileId}.jpg` : 'upload.jpg'),
    ]);

    if (!rawText) {
      return res.status(502).json({ error: 'gemini_error', image_url: imageUrl });
    }
    const parsed = extractJson(rawText) as Record<string, unknown> | null;
    if (!parsed) {
      return res.status(200).json({
        intent: 'chatter', confidence: 0,
        description: 'Could not parse vision response.',
        summary: '(image received)',
        reply: 'Got the image — not sure what to do with it. Tell me?',
        action: null,
        image_url: imageUrl,
        parse_error: 'gemini returned non-JSON',
        raw_preview: rawText.slice(0, 200),
      });
    }

    // If the model proposed an action that supports a description /
    // notes field, embed the image link so the boss's downstream card
    // carries a clickable reference to the original.
    if (imageUrl && parsed.action && typeof parsed.action === 'object') {
      const action = parsed.action as Record<string, unknown>;
      const link = `\n\nImage: ${imageUrl}`;
      if (action.type === 'create_kanban_card') {
        action.description = `${(action.description as string) || ''}${link}`.trim();
      } else if (action.type === 'create_kanban_cards' && Array.isArray(action.cards) && action.cards.length > 0) {
        const c0 = action.cards[0] as Record<string, unknown>;
        c0.description = `${(c0.description as string) || ''}${link}`.trim();
      } else if (action.type === 'create_finance_task') {
        action.notes = `${(action.notes as string) || ''}${link}`.trim();
      }
    }

    res.json({ ...parsed, image_url: imageUrl });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

function guessMediaType(path: string): string | null {
  const m = path.toLowerCase().match(/\.(jpe?g|png|gif|webp)(?:\?|$)/);
  if (!m) return null;
  return m[1] === 'jpg' ? 'image/jpeg' : `image/${m[1]}`;
}

// Pull the first JSON object out of Claude's reply, even if wrapped
// in prose or a fenced code block. Returns null if nothing parses.
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    return typeof obj === 'object' && obj !== null ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

app.post('/api/agent/summary',
  requireRole('boss', 'pa'),
  async (_req, res) => {
    try {
      const rows = await query(
        `SELECT s.name, s.role, d.report_date, d.goals, d.mid_progress,
                d.mid_issues, d.eod_completed, d.eod_unfinished, d.eod_hours
           FROM ops.report_subscribers s
      LEFT JOIN ops.daily_reports d
             ON d.subscriber_id = s.id
            AND d.report_date = (now() AT TIME ZONE s.timezone)::date
          WHERE s.active = true`
      );
      if (rows.length === 0) {
        return res.json({ summary: 'No active subscribers yet. Add teammates in the Team tab.' });
      }
      if (!ANTHROPIC_API_KEY) {
        return res.json({ summary: '(ANTHROPIC_API_KEY not configured on Railway)' });
      }
      const system =
        "You are a concise executive operations analyst producing a standup brief. " +
        "Given raw daily-report rows, write 3-4 sentences: who filed what, any blockers " +
        "or missing slots, and total hours logged. Name people explicitly. Plain prose, " +
        "no markdown.";
      const userMessage =
        "Today's report data (one row per active subscriber; null fields mean that " +
        "slot hasn't been filled yet):\n\n" + JSON.stringify(rows, null, 2);
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await upstream.json().catch(() => ({} as any));
      const text =
        data?.content?.[0]?.text ||
        data?.error?.message ||
        '(Claude returned nothing — check ANTHROPIC_API_KEY.)';
      res.json({ summary: text, rows: rows.length });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Kanban ------------------------------------------------ //
// Single shared board. Columns are seeded by migration; cards carry an
// integer `position` per column. Every mutation writes a row into
// ops.kanban_activity so the Activity page has a stable audit trail.

async function logActivity(
  actorEmail: string,
  cardId: string | null,
  action: string,
  payload: Record<string, unknown> = {}
) {
  try {
    await query(
      `INSERT INTO ops.kanban_activity (card_id, actor_email, action, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [cardId, actorEmail, action, JSON.stringify(payload)]
    );
  } catch (e) {
    // Activity log failures must not block the user's mutation.
    console.error('[teamscope] activity log write failed:', (e as Error).message);
  }
}

// ---------- Telegram notifier ------------------------------------- //
// Fire-and-forget DM sender. When TELEGRAM_BOT_TOKEN is blank the
// helper short-circuits so self-hosted/dev environments don't fail.
// Retries once on network-level errors because Node's undici fetch
// occasionally fails cold-start the first time after process start.
async function sendTelegramMessage(chatId: number, text: string): Promise<'sent' | 'disabled' | 'failed'> {
  if (!TELEGRAM_BOT_TOKEN) return 'disabled';
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
  const headers = { 'content-type': 'application/json' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Telegram 4xx responses won't get better on retry.
        console.error('[teamscope] telegram send failed:', res.status, text.slice(0, 200));
        return 'failed';
      }
      return 'sent';
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (attempt === 2) {
        console.error('[teamscope] telegram send error after retry:', err.message,
          err.cause?.code ? `(${err.cause.code})` : '');
        return 'failed';
      }
      // Backoff a beat and try again — usually a transient undici hiccup.
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return 'failed';
}

// =================================================================== //
// Email subsystem (mirrors Clipy AI's app/services/email/* layout)    //
// =================================================================== //
// EMAIL_EVENT_CATALOG is the single source of truth for every
// transactional email teamscope sends. Each event declares the
// audience, default subject + body in en + zh, and the keys it expects
// in the context dict. DB-stored ops.email_templates rows override the
// in-code defaults per (event_id, language).

type EmailAudience = 'subscriber' | 'boss' | 'pa' | 'support_user';

interface EmailTemplate {
  subject: string;
  body: string;     // plain text; {key} placeholders substituted from context
}

interface EmailEvent {
  id: string;
  audience: EmailAudience;
  when_fired: string;
  required_context: readonly string[];
  templates: Record<'en' | 'zh', EmailTemplate>;
}

const EMAIL_EVENT_CATALOG: readonly EmailEvent[] = [
  {
    id: 'card.assigned',
    audience: 'subscriber',
    when_fired: 'A boss / PA assigns a card to a member',
    required_context: ['recipient_name', 'card_title', 'card_url', 'actor_name'],
    templates: {
      en: {
        subject: 'New card assigned: {card_title}',
        body:
`Hi {recipient_name},

{actor_name} assigned a card to you on TeamScope:

  {card_title}

Open it: {card_url}

— TeamScope`,
      },
      zh: {
        subject: '有新卡片指派給你: {card_title}',
        body:
`{recipient_name} 你好,

{actor_name} 在 TeamScope 將卡片指派給你:

  {card_title}

開啟卡片: {card_url}

— TeamScope`,
      },
    },
  },
  {
    id: 'card.mentioned',
    audience: 'subscriber',
    when_fired: '@member appears in a card description or comment',
    required_context: ['recipient_name', 'card_title', 'card_url', 'actor_name', 'context_kind'],
    templates: {
      en: {
        subject: '{actor_name} mentioned you in {card_title}',
        body:
`Hi {recipient_name},

{actor_name} mentioned you in a {context_kind} on TeamScope:

  {card_title}

Open: {card_url}

— TeamScope`,
      },
      zh: {
        subject: '{actor_name} 在 {card_title} 提到你',
        body:
`{recipient_name} 你好,

{actor_name} 在 TeamScope 的{context_kind}中提到你:

  {card_title}

開啟: {card_url}

— TeamScope`,
      },
    },
  },
  {
    id: 'card.commented',
    audience: 'subscriber',
    when_fired: 'A new comment is added to a card you are assigned to',
    required_context: ['recipient_name', 'card_title', 'card_url', 'actor_name', 'comment_preview'],
    templates: {
      en: {
        subject: 'New comment on {card_title}',
        body:
`Hi {recipient_name},

{actor_name} commented on a card you're on:

  "{comment_preview}"

Reply: {card_url}

— TeamScope`,
      },
      zh: {
        subject: '{card_title} 有新留言',
        body:
`{recipient_name} 你好,

{actor_name} 在你負責的卡片留言:

  「{comment_preview}」

回覆: {card_url}

— TeamScope`,
      },
    },
  },
  {
    id: 'report.eod_missed',
    audience: 'subscriber',
    when_fired: 'Daily missed-slot digest job runs and finds an EOD missed',
    required_context: ['recipient_name', 'report_date'],
    templates: {
      en: {
        subject: 'You missed your EOD report for {report_date}',
        body:
`Hi {recipient_name},

Heads up — you didn't file your end-of-day report for {report_date}.

Reply to @edpapabot on Telegram, or log it on the web at {app_url}.

— TeamScope`,
      },
      zh: {
        subject: '{report_date} 的日結報告未提交',
        body:
`{recipient_name} 你好,

提醒一下 — 你還沒有提交 {report_date} 的日結報告。

請在 Telegram 回覆 @edpapabot,或在 {app_url} 補登。

— TeamScope`,
      },
    },
  },
  {
    id: 'share.link_invited',
    audience: 'support_user',
    when_fired: 'Boss shares a board via email from the Share modal (manual)',
    required_context: ['recipient_name', 'board_name', 'share_url', 'actor_name', 'mode'],
    templates: {
      en: {
        subject: '{actor_name} shared the {board_name} board with you',
        body:
`Hi {recipient_name},

{actor_name} shared the "{board_name}" board with you on TeamScope.

Permission: {mode}

Open: {share_url}

— TeamScope`,
      },
      zh: {
        subject: '{actor_name} 與你分享了 {board_name} 看板',
        body:
`{recipient_name} 你好,

{actor_name} 在 TeamScope 與你分享了「{board_name}」看板。

權限: {mode}

開啟: {share_url}

— TeamScope`,
      },
    },
  },
  {
    id: 'support.ticket_replied',
    audience: 'support_user',
    when_fired: 'Staff reply on a support ticket — DMs the requester',
    required_context: ['recipient_name', 'ticket_subject', 'ticket_url', 'reply_preview'],
    templates: {
      en: {
        subject: 'Re: {ticket_subject}',
        body:
`Hi {recipient_name},

Your support ticket got a reply:

  "{reply_preview}"

Continue the thread: {ticket_url}

— TeamScope Support`,
      },
      zh: {
        subject: '回覆: {ticket_subject}',
        body:
`{recipient_name} 你好,

你的支援工單已有回覆:

  「{reply_preview}」

繼續對話: {ticket_url}

— TeamScope 支援`,
      },
    },
  },
] as const;

const EMAIL_EVENTS_BY_ID: Record<string, EmailEvent> = Object.fromEntries(
  EMAIL_EVENT_CATALOG.map(e => [e.id, e])
);

function substituteTemplate(text: string, context: Record<string, string | number | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = context[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Resolve the active template for an event in the recipient's language.
// Falls back: DB row in lang → DB row in en → in-code default in lang →
// in-code default in en. Anything else returns null and the dispatcher
// logs status='skipped'.
async function resolveEmailTemplate(
  eventId: string,
  language: 'en' | 'zh',
): Promise<EmailTemplate | null> {
  const event = EMAIL_EVENTS_BY_ID[eventId];
  if (!event) return null;
  // DB overrides if present.
  const rows = await query<{ language: string; subject: string; body: string }>(
    `SELECT language, subject, body FROM ops.email_templates
      WHERE event_id = $1 AND language = ANY($2::text[])`,
    [eventId, [language, 'en']]
  );
  const byLang = new Map(rows.map(r => [r.language, r]));
  const dbRow = byLang.get(language) || byLang.get('en');
  if (dbRow) return { subject: dbRow.subject, body: dbRow.body };
  return event.templates[language] || event.templates.en;
}

// Send via Resend. Returns provider-id on success.
async function sendViaResend(
  to: string, subject: string, body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'resend_disabled' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
        to: [to],
        subject,
        text: body,
      }),
    });
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) {
      return { ok: false, error: `resend ${r.status}: ${JSON.stringify(data).slice(0, 200)}` };
    }
    const id = (data as { id?: string }).id || '';
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Public dispatcher — the one trigger sites call. Renders via the
// catalog + DB overrides, sends via Resend, writes an EmailLog row,
// optionally also creates an in-app Notification.
async function sendEmail(args: {
  eventId: string;
  recipientEmail: string;
  language?: 'en' | 'zh';
  context: Record<string, string | number | undefined>;
  actorEmail?: string;
  alsoNotify?: { kind: string; title: string; body?: string; linkUrl?: string };
}): Promise<void> {
  const lang = args.language || 'en';
  const event = EMAIL_EVENTS_BY_ID[args.eventId];
  if (!event) {
    console.error('[teamscope] sendEmail: unknown event_id', args.eventId);
    return;
  }
  // Validate the caller passed every required key — rough sanity, not
  // a hard fail since the substitute step renders missing keys to ''.
  const missing = event.required_context.filter(k => !(k in args.context));
  if (missing.length > 0) {
    console.warn('[teamscope] sendEmail missing context keys:',
      args.eventId, missing.join(','));
  }
  const tpl = await resolveEmailTemplate(args.eventId, lang);
  if (!tpl) {
    await query(
      `INSERT INTO ops.email_logs
         (event_id, recipient_email, language, status, error, actor_email)
       VALUES ($1, $2, $3, 'skipped', 'no_template', $4)`,
      [args.eventId, args.recipientEmail, lang, args.actorEmail ?? null]
    );
    return;
  }
  const ctx = { app_url: APP_URL, ...args.context };
  const subject = substituteTemplate(tpl.subject, ctx);
  const body = substituteTemplate(tpl.body, ctx);
  const previewCtx = Object.fromEntries(
    Object.entries(ctx).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v])
  );
  const logRows = await query<{ id: string }>(
    `INSERT INTO ops.email_logs
       (event_id, recipient_email, subject, language, status, context_preview, actor_email)
     VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6)
     RETURNING id`,
    [args.eventId, args.recipientEmail, subject, lang,
     JSON.stringify(previewCtx), args.actorEmail ?? null]
  );
  const logId = logRows[0].id;
  const result = await sendViaResend(args.recipientEmail, subject, body);
  if (result.ok === true) {
    await query(
      `UPDATE ops.email_logs
          SET status = 'sent', provider = 'resend', provider_id = $1,
              sent_at = now()
        WHERE id = $2`,
      [result.id, logId]
    );
  } else {
    const errorMsg = result.error;
    await query(
      `UPDATE ops.email_logs
          SET status = $1, error = $2, provider = 'resend'
        WHERE id = $3`,
      [errorMsg === 'resend_disabled' ? 'skipped' : 'failed',
       errorMsg, logId]
    );
  }
  // In-app notification mirror (independent of email outcome).
  if (args.alsoNotify) {
    await createNotification({
      recipientEmail: args.recipientEmail,
      kind: args.alsoNotify.kind,
      title: args.alsoNotify.title,
      body: args.alsoNotify.body,
      linkUrl: args.alsoNotify.linkUrl,
    });
  }
}

async function createNotification(args: {
  recipientEmail: string;
  kind: string;
  title: string;
  body?: string;
  linkUrl?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO ops.notifications (recipient_email, kind, title, body, link_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [args.recipientEmail.toLowerCase(), args.kind, args.title,
       args.body ?? null, args.linkUrl ?? null]
    );
  } catch (e) {
    console.error('[teamscope] notification insert failed:', (e as Error).message);
  }
}

// In-app notifications API — used by the sidebar bell.
app.get('/api/notifications', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, kind, title, body, link_url, read_at, created_at
         FROM ops.notifications
        WHERE recipient_email = $1
        ORDER BY created_at DESC LIMIT 50`,
      [req.user!.email.toLowerCase()]
    );
    const unread = rows.filter((r: any) => r.read_at === null).length;
    res.json({ notifications: rows, unread });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    await query(
      `UPDATE ops.notifications SET read_at = now()
        WHERE id = $1 AND recipient_email = $2 AND read_at IS NULL`,
      [String(req.params.id), req.user!.email.toLowerCase()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    await query(
      `UPDATE ops.notifications SET read_at = now()
        WHERE recipient_email = $1 AND read_at IS NULL`,
      [req.user!.email.toLowerCase()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---- Admin: email events / templates / logs ---------------------- //
app.get('/api/admin/email-events', requireRole('boss'), (_req, res) => {
  res.json({
    events: EMAIL_EVENT_CATALOG.map(e => ({
      id: e.id, audience: e.audience,
      when_fired: e.when_fired,
      required_context: e.required_context,
      defaults: e.templates,
    })),
  });
});

app.get('/api/admin/email-templates', requireRole('boss'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT event_id, language, subject, body, updated_at, updated_by
         FROM ops.email_templates ORDER BY event_id, language`
    );
    res.json({ overrides: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.patch('/api/admin/email-templates/:event/:language',
  requireRole('boss'),
  async (req, res) => {
    const eventId = String(req.params.event);
    const language = String(req.params.language);
    if (!EMAIL_EVENTS_BY_ID[eventId]) {
      return res.status(404).json({ error: 'unknown_event' });
    }
    if (language !== 'en' && language !== 'zh') {
      return res.status(400).json({ error: 'language must be en|zh' });
    }
    const subject = ((req.body?.subject as string) || '').trim();
    const body = ((req.body?.body as string) || '').trim();
    if (!subject || !body) return res.status(400).json({ error: 'subject + body required' });
    try {
      const rows = await query(
        `INSERT INTO ops.email_templates (event_id, language, subject, body, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id, language) DO UPDATE
           SET subject = EXCLUDED.subject, body = EXCLUDED.body,
               updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING event_id, language, subject, body, updated_at, updated_by`,
        [eventId, language, subject, body, req.user!.email]
      );
      res.json({ template: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/admin/email-templates/:event/:language',
  requireRole('boss'),
  async (req, res) => {
    try {
      await query(
        `DELETE FROM ops.email_templates WHERE event_id = $1 AND language = $2`,
        [String(req.params.event), String(req.params.language)]
      );
      res.json({ deleted: true });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.get('/api/admin/email-logs', requireRole('boss'), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  try {
    const rows = await query(
      `SELECT id, event_id, recipient_email, subject, language, status,
              provider, provider_id, error, actor_email, created_at, sent_at
         FROM ops.email_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ logs: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// =================================================================== //
// (end email subsystem)
// =================================================================== //

// Notify a set of subscribers about a card assignment. Runs outside
// the user-facing request path — never awaited from the endpoint so
// a slow Telegram API call does not delay the HTTP response.
async function notifyAssignment(
  subscriberIds: string[],
  card: { id: string; title: string },
  actorEmail: string
) {
  if (subscriberIds.length === 0) return;
  try {
    const rows = await query<{
      id: string; name: string; telegram_chat_id: number;
      email: string | null; language: 'en' | 'zh';
    }>(
      `SELECT id, name, telegram_chat_id, email, language
         FROM ops.report_subscribers
        WHERE id = ANY($1::uuid[]) AND active = true`,
      [subscriberIds]
    );
    const link = APP_URL ? `\n\n→ ${APP_URL}` : '';
    const body =
      `📋 *New task assigned*\n\n` +
      `_${escapeMarkdown(card.title)}_${link}`;
    const cardUrl = APP_URL ? `${APP_URL}/board` : '';
    for (const sub of rows) {
      const outcome = await sendTelegramMessage(sub.telegram_chat_id, body);
      console.log(
        `[teamscope] notify ${sub.name} (${sub.telegram_chat_id}) ` +
        `about card ${card.id.slice(0, 8)} → ${outcome} (by ${actorEmail})`
      );
      // Email + in-app notification (in addition to Telegram). Email
      // skipped if no address recorded for this subscriber. The bell
      // notification always fires for the team-member email if known.
      if (sub.email) {
        sendEmail({
          eventId: 'card.assigned',
          recipientEmail: sub.email,
          language: sub.language || 'en',
          context: {
            recipient_name: sub.name,
            card_title: card.title,
            card_url: cardUrl,
            actor_name: actorEmail.split('@')[0],
          },
          actorEmail,
          alsoNotify: {
            kind: 'card.assigned',
            title: `New card assigned: ${card.title}`,
            body: `By ${actorEmail.split('@')[0]}`,
            linkUrl: cardUrl,
          },
        }).catch(e => console.error('[teamscope] sendEmail card.assigned:', (e as Error).message));
      }
    }
  } catch (e) {
    console.error('[teamscope] notify error:', (e as Error).message);
  }
}

// Telegram Markdown has a narrow safe set; escape the ones the API cares about.
function escapeMarkdown(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
}

// Pull @mention tokens from text. Names are alphanumeric + underscore +
// hyphen. Stop at whitespace or punctuation. Lowercased for matching.
function extractMentionHandles(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /(^|[^\w@])@([A-Za-z][\w-]{0,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[2].toLowerCase());
  }
  return [...out];
}

// Resolve a list of mention handles to subscriber rows. Match is
// case-insensitive against the subscriber's full name with whitespace
// removed (so "@meghanang" matches "Meghan Ang"). Names that don't
// resolve are silently dropped — no point spamming "no such user".
async function resolveMentions(
  handles: string[],
  excludeEmail?: string,
): Promise<Array<{ id: string; name: string; telegram_chat_id: number }>> {
  if (handles.length === 0) return [];
  const rows = await query<{
    id: string; name: string; telegram_chat_id: number;
    email: string | null;
  }>(
    `SELECT id, name, telegram_chat_id, email
       FROM ops.report_subscribers
      WHERE active = true AND telegram_chat_id IS NOT NULL`
  );
  const matched: typeof rows = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const handle = r.name.replace(/\s+/g, '').toLowerCase();
    if (handles.includes(handle) && !seen.has(r.id)) {
      if (excludeEmail && r.email && r.email.toLowerCase() === excludeEmail.toLowerCase()) continue;
      seen.add(r.id);
      matched.push(r);
    }
  }
  return matched;
}

// Fire-and-forget DM notifications for newly-mentioned subscribers in a
// card description or comment. Each recipient gets one message per
// mention event — caller supplies the contextual title + URL.
async function notifyMentions(
  text: string | null,
  context: { kind: 'card' | 'comment'; cardId: string; cardTitle: string },
  actorEmail: string,
) {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return;
  try {
    const targets = await resolveMentions(handles, actorEmail);
    if (targets.length === 0) return;
    const link = APP_URL ? `\n\n→ ${APP_URL}` : '';
    const verb = context.kind === 'comment' ? 'mentioned you in a comment on' : 'mentioned you in a card';
    const body =
      `🔔 *${escapeMarkdown(actorEmail.split('@')[0])}* ${verb}\n\n` +
      `_${escapeMarkdown(context.cardTitle)}_${link}`;
    for (const sub of targets) {
      const outcome = await sendTelegramMessage(sub.telegram_chat_id, body);
      console.log(
        `[teamscope] mention ${sub.name} (${sub.telegram_chat_id}) ` +
        `via ${context.kind} on card ${context.cardId.slice(0, 8)} → ${outcome}`
      );
    }
  } catch (e) {
    console.error('[teamscope] mention notify error:', (e as Error).message);
  }
}

// Compute the set of mentions added between two text revisions so we
// only DM on the newly-introduced ones. Used by card description PATCH.
function newMentionsOnly(prev: string | null | undefined, next: string | null | undefined): string {
  const prevSet = new Set(extractMentionHandles(prev));
  const onlyNew = extractMentionHandles(next).filter(h => !prevSet.has(h));
  if (onlyNew.length === 0) return '';
  // Synthesize a fake text containing just the new handles so the same
  // notifyMentions(text, …) extractor downstream picks them up.
  return onlyNew.map(h => `@${h}`).join(' ');
}

// Map common pg errors to HTTP 4xx so bad client input doesn't
// surface as 500. Everything else stays a 500.
function pgErrorStatus(e: unknown): number {
  const code = (e as { code?: string } | null)?.code;
  if (code === '23503') return 400; // FK violation — referenced row missing
  if (code === '22P02') return 400; // invalid text representation (bad UUID)
  if (code === '23505') return 409; // unique violation
  return 500;
}

// Full board load: columns + cards + assignees, in one round-trip.
// Default board: the row flagged is_default. Falls back to the oldest
// board so the agent never has nowhere to write.
async function getDefaultBoardId(): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM ops.kanban_boards
      WHERE deleted_at IS NULL
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function loadBoardData(boardId: string) {
  const [columns, cards, assignees, subscribers, labels, cardLabels, checklistAgg] = await Promise.all([
    query<{ id: string; name: string; position: number; is_done: boolean; wip_limit: number | null }>(
      `SELECT id, name, position, is_done, wip_limit
         FROM ops.kanban_columns
        WHERE deleted_at IS NULL AND board_id = $1
        ORDER BY position`,
      [boardId]
    ),
    query(
      `SELECT c.id, c.column_id, c.title, c.description, c.priority, c.position, c.due_date,
              c.created_by, c.created_at, c.updated_at, c.done_at,
              c.source_kind, c.source_ref, c.image_urls
         FROM ops.kanban_cards c
         JOIN ops.kanban_columns col ON col.id = c.column_id
        WHERE c.deleted_at IS NULL AND col.board_id = $1
        ORDER BY c.column_id, c.position`,
      [boardId]
    ),
    query<{ card_id: string; subscriber_id: string; assigned_at: string }>(
      `SELECT a.card_id, a.subscriber_id, a.assigned_at
         FROM ops.kanban_assignees a
         JOIN ops.kanban_cards c   ON c.id = a.card_id
         JOIN ops.kanban_columns col ON col.id = c.column_id
        WHERE c.deleted_at IS NULL AND col.board_id = $1`,
      [boardId]
    ),
    query(
      `SELECT id, name, role, timezone, telegram_chat_id, active
         FROM ops.report_subscribers
        ORDER BY active DESC, name`
    ),
    query<LabelRow>(
      `SELECT id, board_id, name, color, position
         FROM ops.kanban_labels WHERE board_id = $1
        ORDER BY position, name`,
      [boardId]
    ),
    query<{ card_id: string; label_id: string }>(
      `SELECT cl.card_id, cl.label_id
         FROM ops.kanban_card_labels cl
         JOIN ops.kanban_cards c ON c.id = cl.card_id
         JOIN ops.kanban_columns col ON col.id = c.column_id
        WHERE c.deleted_at IS NULL AND col.board_id = $1`,
      [boardId]
    ),
    query<{ card_id: string; total: number; done: number }>(
      `SELECT ci.card_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ci.done)::int AS done
         FROM ops.kanban_card_checklist_items ci
         JOIN ops.kanban_cards c ON c.id = ci.card_id
         JOIN ops.kanban_columns col ON col.id = c.column_id
        WHERE c.deleted_at IS NULL AND col.board_id = $1
        GROUP BY ci.card_id`,
      [boardId]
    ),
  ]);
  return { columns, cards, assignees, subscribers, labels, card_labels: cardLabels, checklist_progress: checklistAgg };
}

// List all boards (folders). Anyone whitelisted can see all of them.
app.get('/api/kanban/boards', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, is_default,
              CASE WHEN share_token IS NULL THEN false ELSE true END AS share_enabled,
              share_mode, share_token,
              created_by, created_at, updated_at
         FROM ops.kanban_boards
        WHERE deleted_at IS NULL
        ORDER BY is_default DESC, created_at`
    );
    res.json({ boards: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Create a new board (folder). Boss only. Optionally seeds default columns
// so the boss isn't staring at an empty page.
app.post('/api/kanban/boards', requireRole('boss'), async (req, res) => {
  const name = ((req.body?.name as string) || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO ops.kanban_boards (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, is_default, created_at`,
      [name, req.user!.email]
    );
    const board = ins.rows[0];
    const seedColumns = ['Backlog', 'Today', 'In Progress', 'Blocked', 'Done'];
    for (let i = 0; i < seedColumns.length; i++) {
      const isDone = seedColumns[i] === 'Done';
      await client.query(
        `INSERT INTO ops.kanban_columns (board_id, name, position, is_done)
         VALUES ($1, $2, $3, $4)`,
        [board.id, seedColumns[i], i, isDone]
      );
    }
    await client.query('COMMIT');
    res.json({ board });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// Rename / mark default. Boss only.
app.patch('/api/kanban/boards/:id', requireRole('boss'), async (req, res) => {
  const b = req.body || {};
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.name === 'string' && b.name.trim()) {
    sets.push(`name = $${sets.length + 1}`);
    vals.push(b.name.trim());
  }
  if (b.is_default === true) {
    // Single-default invariant: clear everyone else first.
    await query(`UPDATE ops.kanban_boards SET is_default = false WHERE is_default = true`);
    sets.push(`is_default = $${sets.length + 1}`);
    vals.push(true);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE ops.kanban_boards SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${vals.length} AND deleted_at IS NULL
       RETURNING id, name, is_default, share_mode, share_token, updated_at`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ board: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Soft-delete a board. Boss only. Refuses to delete the default board so
// the agent flow always has somewhere to write.
app.delete('/api/kanban/boards/:id', requireRole('boss'), async (req, res) => {
  try {
    const rows = await query<{ is_default: boolean }>(
      `SELECT is_default FROM ops.kanban_boards
        WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (rows[0].is_default) {
      return res.status(409).json({ error: 'cannot_delete_default_board' });
    }
    await query(
      `UPDATE ops.kanban_boards SET deleted_at = now() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ deleted: req.params.id });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Enable / regenerate / change-mode for a board's share link. Boss only.
// POST { mode: 'view' | 'edit' } → returns the active token.
app.post('/api/kanban/boards/:id/share', requireRole('boss'), async (req, res) => {
  const mode = (req.body?.mode as string) === 'view' ? 'view' : 'edit';
  const token = randomShareToken();
  try {
    const rows = await query<{ id: string; share_token: string; share_mode: string }>(
      `UPDATE ops.kanban_boards
          SET share_token = $1, share_mode = $2, updated_at = now()
        WHERE id = $3 AND deleted_at IS NULL
       RETURNING id, share_token, share_mode`,
      [token, mode, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ board: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Revoke an active share link. Any leaked URL stops working immediately.
app.post('/api/kanban/boards/:id/share/revoke', requireRole('boss'), async (req, res) => {
  try {
    await query(
      `UPDATE ops.kanban_boards SET share_token = NULL, updated_at = now()
        WHERE id = $1`,
      [req.params.id]
    );
    res.json({ revoked: req.params.id });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Authenticated board view. ?board_id=X scopes to a specific folder;
// omitted ⇒ default board. Returned shape unchanged from before so the
// existing frontend keeps working without coordination.
app.get('/api/kanban/board', async (req, res) => {
  try {
    const requested = (req.query.board_id as string | undefined)?.trim();
    const boardId = requested || (await getDefaultBoardId());
    if (!boardId) return res.json({ columns: [], cards: [], assignees: [], subscribers: [] });
    const data = await loadBoardData(boardId);
    res.json({ ...data, board_id: boardId });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Public read view by share token. No auth. Returns the same shape plus
// share_mode so the SPA can show edit controls when allowed. Subscribers
// are stripped down (no email / no chat_id) so a leaked link doesn't dox
// the team.
app.get('/api/public/board/:token', async (req, res) => {
  try {
    const rows = await query<{ id: string; name: string; share_mode: string }>(
      `SELECT id, name, share_mode FROM ops.kanban_boards
        WHERE share_token = $1 AND deleted_at IS NULL`,
      [req.params.token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found_or_revoked' });
    const board = rows[0];
    const data = await loadBoardData(board.id);
    res.json({
      board: { id: board.id, name: board.name, share_mode: board.share_mode },
      columns: data.columns,
      cards: data.cards,
      assignees: data.assignees,
      labels: data.labels,
      card_labels: data.card_labels,
      checklist_progress: data.checklist_progress,
      // Only minimal subscriber info needed to render avatars.
      subscribers: data.subscribers.map((s: any) => ({
        id: s.id, name: s.name, role: s.role, active: s.active,
      })),
    });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

function randomShareToken(): string {
  // 24 random bytes → 32 base64url chars; ample entropy and copy-friendly.
  const bytes = nodeCrypto.randomBytes(24);
  return bytes.toString('base64url');
}

// Resolve a share token to (boardId, mode). Returns null if the token is
// missing/revoked. Mutating endpoints call this and 403 unless mode='edit'.
async function resolveShareToken(
  token: string
): Promise<{ boardId: string; mode: 'view' | 'edit' } | null> {
  if (!token) return null;
  const rows = await query<{ id: string; share_mode: 'view' | 'edit' }>(
    `SELECT id, share_mode FROM ops.kanban_boards
      WHERE share_token = $1 AND deleted_at IS NULL`,
    [token]
  );
  if (rows.length === 0) return null;
  return { boardId: rows[0].id, mode: rows[0].share_mode };
}

// Make sure a column belongs to the share's board. Without this an edit-
// mode visitor could pass any column_id and target someone else's folder.
async function columnInBoard(columnId: string, boardId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM ops.kanban_columns
      WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL`,
    [columnId, boardId]
  );
  return rows.length > 0;
}
async function cardInBoard(cardId: string, boardId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM ops.kanban_cards c
       JOIN ops.kanban_columns col ON col.id = c.column_id
      WHERE c.id = $1 AND col.board_id = $2 AND c.deleted_at IS NULL`,
    [cardId, boardId]
  );
  return rows.length > 0;
}

// Generic guard for the public mutation routes. Returns the share scope
// or sends a 403/404 response and false to short-circuit.
async function guardShareEdit(
  token: string, res: Response
): Promise<{ boardId: string } | null> {
  const scope = await resolveShareToken(token);
  if (!scope) {
    res.status(404).json({ error: 'not_found_or_revoked' });
    return null;
  }
  if (scope.mode !== 'edit') {
    res.status(403).json({ error: 'share_link_is_view_only' });
    return null;
  }
  return { boardId: scope.boardId };
}

// Public CREATE card. Mirrors POST /api/kanban/cards but auth via share
// token, scoped to the share's board.
app.post('/api/public/board/:token/cards', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  const b = req.body || {};
  const title = (b.title as string || '').trim();
  const columnId = b.column_id as string;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!columnId) return res.status(400).json({ error: 'column_id required' });
  if (!(await columnInBoard(columnId, scope.boardId))) {
    return res.status(403).json({ error: 'column_outside_share_scope' });
  }
  const assigneeIds: string[] = Array.isArray(b.assignee_ids) ? b.assignee_ids.slice(0, 5) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posRow = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM ops.kanban_cards
        WHERE column_id = $1 AND deleted_at IS NULL`,
      [columnId]
    );
    const position = posRow.rows[0].next_pos;
    const imageUrls = sanitizeImageUrls(b.image_urls);
    const ins = await client.query(
      `INSERT INTO ops.kanban_cards
         (column_id, title, description, priority, position, due_date,
          created_by, source_kind, image_urls)
       VALUES ($1, $2, $3, COALESCE($4, 'medium'), $5, $6, 'share-link', 'share-link', $7)
       RETURNING id, column_id, title, description, priority, position, due_date,
                 created_by, created_at, updated_at, done_at,
                 source_kind, source_ref, image_urls`,
      [columnId, title, b.description ?? null, b.priority ?? null,
       position, b.due_date ?? null, imageUrls]
    );
    const card = ins.rows[0];
    for (const sid of assigneeIds) {
      await client.query(
        `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
         VALUES ($1, $2, 'share-link') ON CONFLICT DO NOTHING`,
        [card.id, sid]
      );
    }
    await client.query('COMMIT');
    await logActivity('share-link', card.id, 'card.created',
      { title: card.title, column_id: card.column_id, via: 'share_link' });
    res.json({ card, assignee_ids: assigneeIds });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// Public PATCH card. Same allowed fields as the authed PATCH.
app.patch('/api/public/board/:token/cards/:id', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  if (!(await cardInBoard(req.params.id, scope.boardId))) {
    return res.status(403).json({ error: 'card_outside_share_scope' });
  }
  const b = req.body || {};
  const fields = ['title', 'description', 'priority', 'due_date'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of fields) {
    if (b[k] !== undefined) {
      sets.push(`${k} = $${sets.length + 1}`);
      vals.push(b[k]);
    }
  }
  if (b.image_urls !== undefined) {
    sets.push(`image_urls = $${sets.length + 1}`);
    vals.push(sanitizeImageUrls(b.image_urls));
  }
  if (sets.length === 0 && !Array.isArray(b.assignee_ids)) {
    return res.status(400).json({ error: 'no fields to update' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (sets.length > 0) {
      vals.push(req.params.id);
      const upd = await client.query(
        `UPDATE ops.kanban_cards SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${vals.length} AND deleted_at IS NULL
        RETURNING id`,
        vals
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not_found' });
      }
    }
    if (Array.isArray(b.assignee_ids)) {
      const ids = (b.assignee_ids as string[]).slice(0, 5);
      await client.query(`DELETE FROM ops.kanban_assignees WHERE card_id = $1`, [req.params.id]);
      for (const sid of ids) {
        await client.query(
          `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
           VALUES ($1, $2, 'share-link') ON CONFLICT DO NOTHING`,
          [req.params.id, sid]
        );
      }
    }
    await client.query('COMMIT');
    await logActivity('share-link', req.params.id, 'card.updated', { via: 'share_link' });
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// Public DELETE card.
app.delete('/api/public/board/:token/cards/:id', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  if (!(await cardInBoard(req.params.id, scope.boardId))) {
    return res.status(403).json({ error: 'card_outside_share_scope' });
  }
  try {
    await query(
      `UPDATE ops.kanban_cards SET deleted_at = now() WHERE id = $1`,
      [req.params.id]
    );
    await logActivity('share-link', req.params.id, 'card.deleted', { via: 'share_link' });
    res.json({ deleted: req.params.id });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Public MOVE card (drag-drop). Body: { column_id, position }.
app.post('/api/public/board/:token/cards/:id/move', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  if (!(await cardInBoard(req.params.id, scope.boardId))) {
    return res.status(403).json({ error: 'card_outside_share_scope' });
  }
  const b = req.body || {};
  const newColumnId = b.column_id as string;
  const newPos = Number(b.position);
  if (!newColumnId || Number.isNaN(newPos)) {
    return res.status(400).json({ error: 'column_id + position required' });
  }
  if (!(await columnInBoard(newColumnId, scope.boardId))) {
    return res.status(403).json({ error: 'column_outside_share_scope' });
  }
  try {
    await query(
      `UPDATE ops.kanban_cards
          SET column_id = $1, position = $2, updated_at = now()
        WHERE id = $3 AND deleted_at IS NULL`,
      [newColumnId, newPos, req.params.id]
    );
    await logActivity('share-link', req.params.id, 'card.moved',
      { column_id: newColumnId, position: newPos, via: 'share_link' });
    res.json({ ok: true });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Public image upload (description paste/drop / dropzone). Used only when
// share_mode='edit'. Requires the same Cloudflare creds as the authed path.
app.post('/api/public/board/:token/uploads/image', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  const b = req.body || {};
  let base64 = (b.base64 as string | undefined) || '';
  let mediaType = (b.media_type as string | undefined) || 'image/jpeg';
  const fileName = (b.filename as string | undefined) || 'upload';
  const dataUrl = b.data_url as string | undefined;
  if (dataUrl && dataUrl.startsWith('data:')) {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'malformed_data_url' });
    mediaType = m[1]; base64 = m[2];
  }
  if (!base64) return res.status(400).json({ error: 'base64_or_data_url_required' });
  if (!mediaType.startsWith('image/')) return res.status(400).json({ error: 'media_type_must_be_image' });
  let buf: Buffer;
  try { buf = Buffer.from(base64, 'base64'); }
  catch { return res.status(400).json({ error: 'invalid_base64' }); }
  if (buf.length === 0) return res.status(400).json({ error: 'empty' });
  if (buf.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'image_too_large' });
  }
  const url = await uploadToCloudflareImages(buf, mediaType, fileName);
  if (!url) return res.status(503).json({ error: 'cf_images_unavailable' });
  res.json({ url });
});

// ---------- Labels (per board) -------------------------------------- //
const LABEL_COLORS = ['slate','red','amber','emerald','sky','indigo','fuchsia','rose'] as const;
type LabelColor = typeof LABEL_COLORS[number];

interface LabelRow {
  id: string; board_id: string; name: string; color: LabelColor; position: number;
}

app.get('/api/kanban/boards/:id/labels', async (req, res) => {
  try {
    const rows = await query<LabelRow>(
      `SELECT id, board_id, name, color, position
         FROM ops.kanban_labels WHERE board_id = $1
        ORDER BY position, name`,
      [String(req.params.id)]
    );
    res.json({ labels: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/kanban/boards/:id/labels',
  requireRole('boss'),
  async (req, res) => {
    const name = ((req.body?.name as string) || '').trim();
    const colorRaw = (req.body?.color as string) || 'slate';
    const color: LabelColor = (LABEL_COLORS as readonly string[]).includes(colorRaw)
      ? (colorRaw as LabelColor) : 'slate';
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const posRow = await query<{ next_pos: number }>(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_labels WHERE board_id = $1`,
        [String(req.params.id)]
      );
      const rows = await query<LabelRow>(
        `INSERT INTO ops.kanban_labels (board_id, name, color, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, board_id, name, color, position`,
        [String(req.params.id), name, color, posRow[0].next_pos]
      );
      res.json({ label: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.patch('/api/kanban/labels/:id', requireRole('boss'), async (req, res) => {
  const b = req.body || {};
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.name === 'string' && b.name.trim()) {
    sets.push(`name = $${sets.length + 1}`); vals.push(b.name.trim());
  }
  if (typeof b.color === 'string' && (LABEL_COLORS as readonly string[]).includes(b.color)) {
    sets.push(`color = $${sets.length + 1}`); vals.push(b.color);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields' });
  vals.push(String(req.params.id));
  try {
    const rows = await query<LabelRow>(
      `UPDATE ops.kanban_labels SET ${sets.join(', ')}
        WHERE id = $${vals.length}
       RETURNING id, board_id, name, color, position`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ label: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.delete('/api/kanban/labels/:id', requireRole('boss'), async (req, res) => {
  try {
    await query(`DELETE FROM ops.kanban_labels WHERE id = $1`, [String(req.params.id)]);
    res.json({ deleted: req.params.id });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Card checklist (subtasks) ------------------------------ //
interface ChecklistItem {
  id: string; card_id: string; text: string; done: boolean; position: number;
}

app.get('/api/kanban/cards/:id/checklist', async (req, res) => {
  try {
    const rows = await query<ChecklistItem>(
      `SELECT id, card_id, text, done, position
         FROM ops.kanban_card_checklist_items
        WHERE card_id = $1
        ORDER BY position`,
      [String(req.params.id)]
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/kanban/cards/:id/checklist',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const text = ((req.body?.text as string) || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const posRow = await query<{ next_pos: number }>(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_card_checklist_items WHERE card_id = $1`,
        [String(req.params.id)]
      );
      const rows = await query<ChecklistItem>(
        `INSERT INTO ops.kanban_card_checklist_items (card_id, text, position)
         VALUES ($1, $2, $3)
         RETURNING id, card_id, text, done, position`,
        [String(req.params.id), text.slice(0, 300), posRow[0].next_pos]
      );
      res.json({ item: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.patch('/api/kanban/checklist/:id',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const b = req.body || {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof b.text === 'string' && b.text.trim()) {
      sets.push(`text = $${sets.length + 1}`); vals.push(b.text.trim().slice(0, 300));
    }
    if (typeof b.done === 'boolean') {
      sets.push(`done = $${sets.length + 1}`); vals.push(b.done);
    }
    if (typeof b.position === 'number') {
      sets.push(`position = $${sets.length + 1}`); vals.push(b.position);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields' });
    sets.push('updated_at = now()');
    vals.push(String(req.params.id));
    try {
      const rows = await query<ChecklistItem>(
        `UPDATE ops.kanban_card_checklist_items SET ${sets.join(', ')}
          WHERE id = $${vals.length}
         RETURNING id, card_id, text, done, position`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ item: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/kanban/checklist/:id',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    try {
      await query(`DELETE FROM ops.kanban_card_checklist_items WHERE id = $1`, [String(req.params.id)]);
      res.json({ deleted: req.params.id });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Card comments + per-card timeline ---------------------- //
// Comments live on cards across both the authed UI and public-edit shared
// boards; share-link visitors author as 'share-link'. The timeline endpoint
// merges comment events with the existing kanban_activity rows so the right
// rail in EditCardModal is one chronological feed.

interface CommentRow {
  id: string; card_id: string; author_email: string;
  body: string; created_at: string; edited_at: string | null;
}

app.get('/api/kanban/cards/:id/comments', async (req, res) => {
  try {
    const rows = await query<CommentRow>(
      `SELECT id, card_id, author_email, body, created_at, edited_at
         FROM ops.kanban_card_comments
        WHERE card_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/kanban/cards/:id/comments',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const body = ((req.body?.body as string) || '').trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    if (body.length > 4000) return res.status(400).json({ error: 'body too long (4000 max)' });
    try {
      const rows = await query<CommentRow>(
        `INSERT INTO ops.kanban_card_comments (card_id, author_email, body)
         VALUES ($1, $2, $3)
         RETURNING id, card_id, author_email, body, created_at, edited_at`,
        [req.params.id, req.user!.email, body]
      );
      await logActivity(req.user!.email, String(req.params.id), 'card.commented',
        { comment_id: rows[0].id, body_preview: body.slice(0, 120) });
      // Mention DMs — every new comment is its own discrete event so we
      // don't bother diffing against an "old comment".
      const titleRow = await query<{ title: string }>(
        `SELECT title FROM ops.kanban_cards WHERE id = $1`, [String(req.params.id)]
      );
      notifyMentions(body,
        { kind: 'comment', cardId: String(req.params.id), cardTitle: titleRow[0]?.title || '(card)' },
        req.user!.email);
      res.json({ comment: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.patch('/api/kanban/comments/:id', async (req, res) => {
  const body = ((req.body?.body as string) || '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  try {
    const rows = await query<CommentRow>(
      `UPDATE ops.kanban_card_comments
          SET body = $1, edited_at = now()
        WHERE id = $2 AND deleted_at IS NULL
          AND (author_email = $3 OR $4 = 'boss')
       RETURNING id, card_id, author_email, body, created_at, edited_at`,
      [body, req.params.id, req.user.email, req.user.role]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not_owner' });
    res.json({ comment: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.delete('/api/kanban/comments/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  try {
    const rows = await query<{ id: string }>(
      `UPDATE ops.kanban_card_comments
          SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
          AND (author_email = $2 OR $3 = 'boss')
       RETURNING id`,
      [req.params.id, req.user.email, req.user.role]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not_owner' });
    res.json({ deleted: req.params.id });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Merged timeline: comments + activity events for a single card,
// sorted ascending. Used by the EditCardModal right-rail Activity tab.
app.get('/api/kanban/cards/:id/timeline', async (req, res) => {
  try {
    const [comments, events] = await Promise.all([
      query<CommentRow>(
        `SELECT id, card_id, author_email, body, created_at, edited_at
           FROM ops.kanban_card_comments
          WHERE card_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      ),
      query<{ id: string; actor_email: string; action: string; payload: unknown; created_at: string }>(
        `SELECT id, actor_email, action, payload, created_at
           FROM ops.kanban_activity
          WHERE card_id = $1
          ORDER BY created_at ASC`,
        [req.params.id]
      ),
    ]);
    res.json({ comments, events });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Public POST comment for share-edit visitors. View-only links 403.
app.post('/api/public/board/:token/cards/:id/comments', async (req, res) => {
  const scope = await guardShareEdit(req.params.token, res);
  if (!scope) return;
  if (!(await cardInBoard(req.params.id, scope.boardId))) {
    return res.status(403).json({ error: 'card_outside_share_scope' });
  }
  const body = ((req.body?.body as string) || '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  if (body.length > 4000) return res.status(400).json({ error: 'body too long (4000 max)' });
  try {
    const rows = await query<CommentRow>(
      `INSERT INTO ops.kanban_card_comments (card_id, author_email, body)
       VALUES ($1, 'share-link', $2)
       RETURNING id, card_id, author_email, body, created_at, edited_at`,
      [req.params.id, body]
    );
    await logActivity('share-link', String(req.params.id), 'card.commented',
      { via: 'share_link', body_preview: body.slice(0, 120) });
    const titleRow = await query<{ title: string }>(
      `SELECT title FROM ops.kanban_cards WHERE id = $1`, [String(req.params.id)]
    );
    notifyMentions(body,
      { kind: 'comment', cardId: String(req.params.id), cardTitle: titleRow[0]?.title || '(card)' },
      'share-link');
    res.json({ comment: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Public timeline for share visitors (both view + edit).
app.get('/api/public/board/:token/cards/:id/timeline', async (req, res) => {
  try {
    const scope = await resolveShareToken(req.params.token);
    if (!scope) return res.status(404).json({ error: 'not_found_or_revoked' });
    if (!(await cardInBoard(req.params.id, scope.boardId))) {
      return res.status(403).json({ error: 'card_outside_share_scope' });
    }
    const [comments, events] = await Promise.all([
      query<CommentRow>(
        `SELECT id, card_id, author_email, body, created_at, edited_at
           FROM ops.kanban_card_comments
          WHERE card_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      ),
      query<{ id: string; actor_email: string; action: string; payload: unknown; created_at: string }>(
        `SELECT id, actor_email, action, payload, created_at
           FROM ops.kanban_activity
          WHERE card_id = $1
          ORDER BY created_at ASC`,
        [req.params.id]
      ),
    ]);
    res.json({ comments, events });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Per-role template sets ---------------------------------- //
// Each subscriber is assigned a set (default / operations /
// customer_service / developer / …). The Report Prompter joins to fetch
// the right text per (set, slot, language). Boss can edit the text or
// add new sets. {name} placeholder is substituted at send time by n8n.

interface TemplateSetRow {
  id: string; name: string; description: string | null;
}
interface TemplateRow {
  template_set_id: string; slot: string; language: string;
  template_text: string; updated_at: string; updated_by: string | null;
}

app.get('/api/config/template-sets', async (_req, res) => {
  try {
    const [sets, templates] = await Promise.all([
      query<TemplateSetRow>(
        `SELECT id, name, description FROM ops.report_template_sets ORDER BY id`
      ),
      query<TemplateRow>(
        `SELECT template_set_id, slot, language, template_text, updated_at, updated_by
           FROM ops.report_prompt_templates_v2
          ORDER BY template_set_id, slot, language`
      ),
    ]);
    // Pivot into a friendly shape: sets[i].templates[slot][language] = text.
    type PivotedSet = TemplateSetRow & {
      templates: Record<string, Record<string, { text: string; updated_at: string; updated_by: string | null }>>;
    };
    const out: PivotedSet[] = sets.map(s => ({ ...s, templates: {} }));
    const byId = new Map(out.map(s => [s.id, s]));
    for (const t of templates) {
      const set = byId.get(t.template_set_id);
      if (!set) continue;
      set.templates[t.slot] = set.templates[t.slot] || {};
      set.templates[t.slot][t.language] = {
        text: t.template_text, updated_at: t.updated_at, updated_by: t.updated_by,
      };
    }
    res.json({ sets: out });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

app.post('/api/config/template-sets',
  requireRole('boss'),
  async (req, res) => {
    const id = ((req.body?.id as string) || '').trim().toLowerCase();
    const name = ((req.body?.name as string) || '').trim();
    const description = (req.body?.description as string | undefined)?.trim() || null;
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      return res.status(400).json({ error: 'id must be lowercase alphanumeric+underscore, start with a letter' });
    }
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      await query(
        `INSERT INTO ops.report_template_sets (id, name, description)
         VALUES ($1, $2, $3)`,
        [id, name, description]
      );
      // Seed the new set by copying default's templates so the boss has
      // something to edit instead of an empty form.
      await query(
        `INSERT INTO ops.report_prompt_templates_v2
              (template_set_id, slot, language, template_text)
         SELECT $1, slot, language, template_text
           FROM ops.report_prompt_templates_v2
          WHERE template_set_id = 'default'`,
        [id]
      );
      res.json({ set: { id, name, description } });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.delete('/api/config/template-sets/:id',
  requireRole('boss'),
  async (req, res) => {
    if (req.params.id === 'default') {
      return res.status(409).json({ error: 'cannot_delete_default_set' });
    }
    try {
      // Members on the deleted set fall back to default automatically.
      await query(
        `UPDATE ops.report_subscribers SET template_set_id = 'default'
          WHERE template_set_id = $1`,
        [String(req.params.id)]
      );
      await query(`DELETE FROM ops.report_template_sets WHERE id = $1`, [String(req.params.id)]);
      res.json({ deleted: req.params.id });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.patch('/api/config/template-sets/:id/templates/:slot/:language',
  requireRole('boss'),
  async (req, res) => {
    const text = ((req.body?.template_text as string) || '').trim();
    if (!text) return res.status(400).json({ error: 'template_text required' });
    const slot = String(req.params.slot);
    const lang = String(req.params.language);
    if (!['morning','midday','eod'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be morning|midday|eod' });
    }
    if (!['zh','en'].includes(lang)) {
      return res.status(400).json({ error: 'language must be zh|en' });
    }
    try {
      const rows = await query<TemplateRow>(
        `INSERT INTO ops.report_prompt_templates_v2
              (template_set_id, slot, language, template_text, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (template_set_id, slot, language) DO UPDATE
           SET template_text = EXCLUDED.template_text,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
       RETURNING template_set_id, slot, language, template_text, updated_at, updated_by`,
        [String(req.params.id), slot, lang, text, req.user!.email]
      );
      res.json({ template: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Global search (⌘K) -------------------------------------- //
// Single endpoint that searches across cards, reports, and members.
// Returns small grouped buckets so the UI can render Linear-style.
// Uses ILIKE rather than pg_trgm for portability — dataset is small.
app.get('/api/search', async (req, res) => {
  const qRaw = (req.query.q as string | undefined) || '';
  const q = qRaw.trim();
  if (q.length < 2) return res.json({ q, cards: [], reports: [], members: [] });
  const wildcard = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
  try {
    const [cards, reports, members] = await Promise.all([
      query<{
        id: string; title: string; description: string | null;
        column_id: string; column_name: string; board_id: string;
        board_name: string; image_urls: string[];
      }>(
        `SELECT c.id, c.title, c.description, c.column_id,
                col.name AS column_name, col.board_id,
                b.name AS board_name, c.image_urls
           FROM ops.kanban_cards c
           JOIN ops.kanban_columns col ON col.id = c.column_id
           JOIN ops.kanban_boards b ON b.id = col.board_id
          WHERE c.deleted_at IS NULL
            AND (c.title ILIKE $1 OR c.description ILIKE $1)
          ORDER BY (c.title ILIKE $1) DESC, c.updated_at DESC
          LIMIT 8`,
        [wildcard]
      ),
      query<{
        id: string; report_date: string; subscriber_id: string;
        subscriber_name: string;
        goals: string | null; mid_progress: string | null;
        eod_completed: string | null;
      }>(
        `SELECT dr.id, to_char(dr.report_date, 'YYYY-MM-DD') AS report_date,
                dr.subscriber_id, s.name AS subscriber_name,
                dr.goals, dr.mid_progress, dr.eod_completed
           FROM ops.daily_reports dr
           JOIN ops.report_subscribers s ON s.id = dr.subscriber_id
          WHERE dr.goals ILIKE $1 OR dr.mid_progress ILIKE $1
             OR dr.eod_completed ILIKE $1 OR dr.eod_unfinished ILIKE $1
          ORDER BY dr.report_date DESC
          LIMIT 6`,
        [wildcard]
      ),
      query<{ id: string; name: string; role: string | null; active: boolean }>(
        `SELECT id, name, role, active
           FROM ops.report_subscribers
          WHERE name ILIKE $1 OR email ILIKE $1
          ORDER BY active DESC, name
          LIMIT 5`,
        [wildcard]
      ),
    ]);
    res.json({ q, cards, reports, members });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Promise tracker (goal items) ---------------------------- //
// One goal_item row per parsed line of a morning report's `goals` text.
// Status of an item is derived: completed if its linked card is in a
// done column, OR the item was manually marked done. Items without a
// card_id are still pending until imported or manually completed.
interface GoalItemView {
  id: string;
  position: number;
  text: string;
  card_id: string | null;
  card_done: boolean;
  card_column_id: string | null;
  manually_done: boolean;
  done: boolean;
}

async function loadGoalItemsForReport(reportId: string): Promise<GoalItemView[]> {
  return await query<GoalItemView>(
    `SELECT gi.id, gi.position, gi.text, gi.card_id, gi.manually_done,
            (c.done_at IS NOT NULL) AS card_done,
            c.column_id AS card_column_id,
            (gi.manually_done OR c.done_at IS NOT NULL) AS done
       FROM ops.report_goal_items gi
       LEFT JOIN ops.kanban_cards c
              ON c.id = gi.card_id AND c.deleted_at IS NULL
      WHERE gi.report_id = $1
      ORDER BY gi.position`,
    [reportId]
  );
}

app.get('/api/reports/:id/goal-items', async (req, res) => {
  try {
    const items = await loadGoalItemsForReport(String(req.params.id));
    res.json({ items });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Toggle the "manually done" flag on a goal item — used when a member
// completed something verbally without ever creating a card for it.
app.post('/api/report-goal-items/:id/toggle-done', async (req, res) => {
  try {
    const rows = await query<{ id: string; manually_done: boolean }>(
      `UPDATE ops.report_goal_items
          SET manually_done = NOT manually_done
        WHERE id = $1
       RETURNING id, manually_done`,
      [String(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ item: rows[0] });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Per-member promise stats for a single date. Drives the Dashboard
// strip and the per-Member tracker card.
app.get('/api/dashboard/promises', async (req, res) => {
  const date = (req.query.date as string | undefined)
    || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const rows = await query<{
      subscriber_id: string; name: string;
      total: number; kept: number;
    }>(
      `SELECT s.id AS subscriber_id, s.name,
              COUNT(gi.*)::int AS total,
              COUNT(*) FILTER (
                WHERE gi.manually_done
                   OR (c.done_at IS NOT NULL AND c.deleted_at IS NULL)
              )::int AS kept
         FROM ops.report_subscribers s
         JOIN ops.daily_reports dr ON dr.subscriber_id = s.id AND dr.report_date = $1::date
         JOIN ops.report_goal_items gi ON gi.report_id = dr.id
         LEFT JOIN ops.kanban_cards c ON c.id = gi.card_id
        WHERE s.active = true
        GROUP BY s.id, s.name
        ORDER BY s.name`,
      [date]
    );
    res.json({ date, members: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Create a card. Position defaults to the end of the target column.
app.post('/api/kanban/cards',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const b = req.body || {};
    const title = (b.title as string || '').trim();
    const columnId = b.column_id as string;
    if (!title) return res.status(400).json({ error: 'title required' });
    if (!columnId) return res.status(400).json({ error: 'column_id required' });
    const assigneeIds: string[] = Array.isArray(b.assignee_ids) ? b.assignee_ids : [];
    if (assigneeIds.length > 5) {
      return res.status(400).json({ error: 'max 5 assignees per card' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const positionRow = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_cards
          WHERE column_id = $1 AND deleted_at IS NULL`,
        [columnId]
      );
      const position = positionRow.rows[0].next_pos;
      const imageUrls = sanitizeImageUrls(b.image_urls);
      const insert = await client.query(
        `INSERT INTO ops.kanban_cards
           (column_id, title, description, priority, position, due_date,
            created_by, source_kind, source_ref, image_urls)
         VALUES ($1, $2, $3, COALESCE($4, 'medium'), $5, $6, $7,
                 COALESCE($8, 'manual'), $9, $10)
         RETURNING id, column_id, title, description, priority, position,
                   due_date, created_by, created_at, updated_at, done_at,
                   source_kind, source_ref, image_urls`,
        [columnId, title, b.description ?? null, b.priority ?? null,
         position, b.due_date ?? null, req.user!.email,
         b.source_kind ?? null, b.source_ref ?? null, imageUrls]
      );
      const card = insert.rows[0];
      for (const sid of assigneeIds) {
        await client.query(
          `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [card.id, sid, req.user!.email]
        );
      }
      const labelIds: string[] = Array.isArray(b.label_ids) ? b.label_ids : [];
      for (const lid of labelIds) {
        await client.query(
          `INSERT INTO ops.kanban_card_labels (card_id, label_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [card.id, lid]
        );
      }
      await client.query('COMMIT');
      await logActivity(req.user!.email, card.id, 'card.created', {
        title: card.title, column_id: card.column_id, assignees: assigneeIds,
      });
      // Fire-and-forget: notify new assignees on Telegram.
      notifyAssignment(assigneeIds, { id: card.id, title: card.title }, req.user!.email);
      notifyMentions(card.description ?? null,
        { kind: 'card', cardId: card.id, cardTitle: card.title }, req.user!.email);
      res.json({ card, assignee_ids: assigneeIds });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    } finally {
      client.release();
    }
  }
);

// Update a card's editable fields. Separate from move to keep intents clear.
app.patch('/api/kanban/cards/:id',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const b = req.body || {};
    const fields = ['title', 'description', 'priority', 'due_date'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of fields) {
      if (b[k] !== undefined) {
        sets.push(`${k} = $${sets.length + 1}`);
        vals.push(b[k]);
      }
    }
    if (b.image_urls !== undefined) {
      sets.push(`image_urls = $${sets.length + 1}`);
      vals.push(sanitizeImageUrls(b.image_urls));
    }
    if (sets.length === 0 && !Array.isArray(b.assignee_ids) && !Array.isArray(b.label_ids)) {
      return res.status(400).json({ error: 'no fields to update' });
    }
    // Capture the prior description before we overwrite it so we can
    // diff and only DM newly-introduced @mentions.
    let priorDescription: string | null = null;
    if (b.description !== undefined) {
      const p = await query<{ description: string | null }>(
        `SELECT description FROM ops.kanban_cards WHERE id = $1`,
        [String(req.params.id)]
      );
      priorDescription = p[0]?.description ?? null;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let card: Record<string, unknown> | null = null;
      if (sets.length) {
        vals.push(req.params.id);
        const r = await client.query(
          `UPDATE ops.kanban_cards
              SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $${vals.length} AND deleted_at IS NULL
          RETURNING id, column_id, title, description, priority, position,
                    due_date, created_by, created_at, updated_at, done_at,
                    source_kind, source_ref`,
          vals
        );
        if (r.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'not_found' });
        }
        card = r.rows[0];
      } else {
        const r = await client.query(
          `SELECT id FROM ops.kanban_cards WHERE id = $1 AND deleted_at IS NULL`,
          [req.params.id]
        );
        if (r.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'not_found' });
        }
      }
      let newlyAssigned: string[] = [];
      if (Array.isArray(b.assignee_ids)) {
        if (b.assignee_ids.length > 5) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'max 5 assignees per card' });
        }
        const priorRows = await client.query<{ subscriber_id: string }>(
          `SELECT subscriber_id FROM ops.kanban_assignees WHERE card_id = $1`,
          [req.params.id]
        );
        const prior = new Set(priorRows.rows.map(r => r.subscriber_id));
        newlyAssigned = b.assignee_ids.filter((id: string) => !prior.has(id));
        await client.query(
          `DELETE FROM ops.kanban_assignees WHERE card_id = $1`,
          [req.params.id]
        );
        for (const sid of b.assignee_ids) {
          await client.query(
            `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [req.params.id, sid, req.user!.email]
          );
        }
      }
      if (Array.isArray(b.label_ids)) {
        await client.query(
          `DELETE FROM ops.kanban_card_labels WHERE card_id = $1`,
          [req.params.id]
        );
        for (const lid of b.label_ids) {
          await client.query(
            `INSERT INTO ops.kanban_card_labels (card_id, label_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [req.params.id, lid]
          );
        }
      }
      await client.query('COMMIT');
      const cardId = String(req.params.id);
      await logActivity(req.user!.email, cardId, 'card.updated', {
        changed: Object.fromEntries(fields.filter(k => b[k] !== undefined).map(k => [k, b[k]])),
        ...(Array.isArray(b.assignee_ids) ? { assignees: b.assignee_ids } : {}),
      });
      // Only notify the newly-added assignees so edits don't spam people
      // who were already on the card.
      let title = (card?.title as string) || '';
      if (newlyAssigned.length > 0 || b.description !== undefined) {
        if (!title) {
          const t = await query<{ title: string }>(
            `SELECT title FROM ops.kanban_cards WHERE id = $1`, [cardId]
          );
          title = t[0]?.title || '(untitled)';
        }
      }
      if (newlyAssigned.length > 0) {
        notifyAssignment(newlyAssigned, { id: cardId, title }, req.user!.email);
      }
      // Description-mention DMs: only fire on newly-added handles so
      // editing a card doesn't ping everyone again.
      if (b.description !== undefined) {
        const synth = newMentionsOnly(priorDescription, b.description as string | null);
        if (synth) {
          notifyMentions(synth,
            { kind: 'card', cardId, cardTitle: title }, req.user!.email);
        }
      }
      res.json({ card: card ?? { id: cardId } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    } finally {
      client.release();
    }
  }
);

// Move a card to a column + position. Sets done_at when target column is_done.
app.put('/api/kanban/cards/:id/move',
  requireRole('boss', 'pa', 'colleague'),
  async (req, res) => {
    const columnId = req.body?.column_id as string;
    const position = Number(req.body?.position);
    if (!columnId || !Number.isFinite(position)) {
      return res.status(400).json({ error: 'column_id + position required' });
    }
    try {
      const colRows = await query<{ is_done: boolean }>(
        `SELECT is_done FROM ops.kanban_columns
          WHERE id = $1 AND deleted_at IS NULL`,
        [columnId]
      );
      if (colRows.length === 0) return res.status(404).json({ error: 'column_not_found' });
      const isDone = colRows[0].is_done;
      const rows = await query(
        `UPDATE ops.kanban_cards
            SET column_id = $1,
                position = $2,
                updated_at = now(),
                done_at = CASE
                  WHEN $3 AND done_at IS NULL THEN now()
                  WHEN NOT $3 THEN NULL
                  ELSE done_at
                END
          WHERE id = $4 AND deleted_at IS NULL
        RETURNING id, column_id, position, done_at`,
        [columnId, position, isDone, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      const cardId = String(req.params.id);
      await logActivity(req.user!.email, cardId, 'card.moved', {
        column_id: columnId, position, is_done: isDone,
      });
      if (isDone) {
        await logActivity(req.user!.email, cardId, 'card.done', {});
      }
      res.json({ card: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Soft-delete a card.
app.delete('/api/kanban/cards/:id',
  requireRole('boss', 'pa'),
  async (req, res) => {
    try {
      const rows = await query(
        `UPDATE ops.kanban_cards
            SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, title`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      await logActivity(req.user!.email, String(req.params.id), 'card.deleted', {
        title: (rows[0] as { title: string }).title,
      });
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Promote an AI-classified pending_action into a Kanban card. Closes
// out the pending_action so the Queue stops re-offering it, and keeps
// the original correlation_id in card.source_ref for traceability.
app.post('/api/kanban/cards/from-action/:correlation_id',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const correlationId = String(req.params.correlation_id);
    const columnId = req.body?.column_id as string;
    const assigneeIds: string[] = Array.isArray(req.body?.assignee_ids) ? req.body.assignee_ids : [];
    const titleOverride = (req.body?.title as string || '').trim();
    if (!columnId) return res.status(400).json({ error: 'column_id required' });
    if (assigneeIds.length > 5) return res.status(400).json({ error: 'max 5 assignees per card' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const action = await client.query(
        `SELECT pa.correlation_id, pa.kind, pa.payload, pa.profile_id,
                m.text AS origin_text
           FROM ops.pending_actions pa
      LEFT JOIN ops.messages m ON m.id = pa.message_id
          WHERE pa.correlation_id = $1`,
        [correlationId]
      );
      if (action.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not_found' });
      }
      const a = action.rows[0];
      const title = (titleOverride || a.origin_text || a.kind || 'Untitled').slice(0, 200);

      const posRow = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_cards
          WHERE column_id = $1 AND deleted_at IS NULL`,
        [columnId]
      );
      const cardRow = await client.query(
        `INSERT INTO ops.kanban_cards
           (column_id, title, description, priority, position,
            created_by, source_kind, source_ref)
         VALUES ($1, $2, $3, 'medium', $4, $5, 'agent', $6)
         RETURNING id, column_id, title, description, priority, position,
                   created_by, created_at, source_kind, source_ref`,
        [columnId, title, a.origin_text, posRow.rows[0].next_pos,
         req.user!.email, correlationId]
      );
      const card = cardRow.rows[0];

      for (const sid of assigneeIds) {
        await client.query(
          `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [card.id, sid, req.user!.email]
        );
      }

      await client.query(
        `UPDATE ops.pending_actions
            SET status = 'completed', resolved_at = now()
          WHERE correlation_id = $1`,
        [correlationId]
      );
      await client.query(
        `INSERT INTO ops.actions_log
           (correlation_id, profile_id, domain, action, executor, outcome)
         VALUES ($1, $2, 'kanban', 'promote_to_card', $3, 'success')`,
        [correlationId, a.profile_id, req.user!.role]
      );
      await client.query('COMMIT');

      await logActivity(req.user!.email, card.id, 'card.created', {
        title, column_id: columnId, assignees: assigneeIds,
        source_kind: 'agent', source_ref: correlationId,
      });
      notifyAssignment(assigneeIds, { id: card.id, title }, req.user!.email);

      res.json({ card, promoted: correlationId });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    } finally {
      client.release();
    }
  }
);

// Promote a daily-report's morning goals into Kanban cards. Parses
// the goals text into line items and creates one card per line in
// the Today column, assigned to the report's subscriber. Refuses
// if any card with source_ref = this report already exists so a
// double-click doesn't duplicate the boss's work.
app.post('/api/kanban/cards/from-report/:report_id',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const reportId = String(req.params.report_id);
    const columnOverride = req.body?.column_id as string | undefined;
    try {
      // Fetch the report + subscriber in one round trip.
      const reports = await query<{
        id: string; subscriber_id: string; goals: string | null; name: string;
      }>(
        `SELECT d.id, d.subscriber_id, d.goals, s.name
           FROM ops.daily_reports d
      LEFT JOIN ops.report_subscribers s ON s.id = d.subscriber_id
          WHERE d.id = $1`,
        [reportId]
      );
      if (reports.length === 0) return res.status(404).json({ error: 'report_not_found' });
      const r = reports[0];
      if (!r.goals || !r.goals.trim()) return res.status(400).json({ error: 'no_goals' });

      // Duplicate guard: has this report already been imported?
      const existing = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ops.kanban_cards
          WHERE source_kind = 'report_goal' AND source_ref = $1 AND deleted_at IS NULL`,
        [reportId]
      );
      if (existing[0].n > 0) {
        return res.status(409).json({ error: 'already_imported', existing: existing[0].n });
      }

      // Pick the target column. Default: one named "Today"; fallback:
      // the first non-done column. If the boss wants another, they POST column_id.
      let targetColumnId = columnOverride;
      if (!targetColumnId) {
        const cols = await query<{ id: string }>(
          `SELECT id FROM ops.kanban_columns
            WHERE deleted_at IS NULL
            ORDER BY CASE WHEN lower(name) = 'today' THEN 0
                          WHEN is_done THEN 2 ELSE 1 END,
                     position LIMIT 1`
        );
        targetColumnId = cols[0]?.id;
      }
      if (!targetColumnId) return res.status(400).json({ error: 'no_target_column' });

      const titles = parseGoalLines(r.goals);
      if (titles.length === 0) return res.status(400).json({ error: 'no parseable goals' });

      const created: Array<{ id: string; title: string; position: number }> = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const posRow = await client.query(
          `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
             FROM ops.kanban_cards
            WHERE column_id = $1 AND deleted_at IS NULL`,
          [targetColumnId]
        );
        let pos: number = posRow.rows[0].next_pos;
        for (let goalIdx = 0; goalIdx < titles.length; goalIdx++) {
          const title = titles[goalIdx];
          const ins = await client.query(
            `INSERT INTO ops.kanban_cards
               (column_id, title, priority, position, created_by,
                source_kind, source_ref)
             VALUES ($1, $2, 'medium', $3, $4, 'report_goal', $5)
             RETURNING id, title, position`,
            [targetColumnId, title, pos, req.user!.email, reportId]
          );
          pos += 1;
          const cardId = ins.rows[0].id as string;
          if (r.subscriber_id) {
            await client.query(
              `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [cardId, r.subscriber_id, req.user!.email]
            );
          }
          // Link the matching goal_item (by position) to this new card
          // so the promise tracker shows it as carded.
          await client.query(
            `UPDATE ops.report_goal_items
                SET card_id = $1
              WHERE report_id = $2 AND position = $3 AND card_id IS NULL`,
            [cardId, reportId, goalIdx]
          );
          created.push(ins.rows[0]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }

      // Activity log, one event per card.
      for (const c of created) {
        await logActivity(req.user!.email, c.id, 'card.created', {
          title: c.title,
          column_id: targetColumnId,
          source_kind: 'report_goal',
          source_ref: reportId,
          assignees: r.subscriber_id ? [r.subscriber_id] : [],
        });
      }
      // Intentionally NO Telegram notify — the subscriber wrote these
      // goals themselves; DMing them back about their own input is noise.

      res.json({ created_count: created.length, cards: created });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// Naive-but-robust goal parser. Splits on newlines, strips common
// bullet/number prefixes, drops blanks, caps lengths. Falls back to
// the raw text as a single card if nothing parseable is found.
function parseGoalLines(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map(l => l.trim()
      .replace(/^[\d]+\s*[.):]\s+/, '') // "1. foo", "1) foo", "1: foo"
      .replace(/^[-*•·‣]\s+/, '')        // "- foo", "• foo", "* foo"
      .replace(/^\[\s*\]\s+/, '')        // "[ ] foo" checkbox style
      .trim())
    .filter(l => l.length > 0);
  if (lines.length === 0) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [trimmed.slice(0, 200)];
  }
  return lines.map(l => l.slice(0, 200)).slice(0, 20);
}

// Column CRUD ------------------------------------------------------- //
app.post('/api/kanban/columns',
  requireRole('boss'),
  async (req, res) => {
    const name = (req.body?.name as string || '').trim();
    const isDone = Boolean(req.body?.is_done);
    const wipLimit = req.body?.wip_limit == null ? null : Number(req.body.wip_limit);
    const requestedBoard = (req.body?.board_id as string | undefined)?.trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const boardId = requestedBoard || (await getDefaultBoardId());
    if (!boardId) return res.status(400).json({ error: 'no board exists' });
    try {
      const posRow = await query<{ next_pos: number }>(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_columns
          WHERE deleted_at IS NULL AND board_id = $1`,
        [boardId]
      );
      const rows = await query(
        `INSERT INTO ops.kanban_columns (board_id, name, position, is_done, wip_limit)
         VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, position, is_done, wip_limit, board_id`,
        [boardId, name, posRow[0].next_pos, isDone, wipLimit]
      );
      await logActivity(req.user!.email, null, 'column.created', rows[0] as Record<string, unknown>);
      res.json({ column: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.patch('/api/kanban/columns/:id',
  requireRole('boss'),
  async (req, res) => {
    const b = req.body || {};
    const fields = ['name', 'is_done', 'wip_limit'] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of fields) {
      if (b[k] !== undefined) {
        sets.push(`${k} = $${sets.length + 1}`);
        vals.push(b[k]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const rows = await query(
        `UPDATE ops.kanban_columns SET ${sets.join(', ')}
          WHERE id = $${vals.length} AND deleted_at IS NULL
        RETURNING id, name, position, is_done, wip_limit`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      await logActivity(req.user!.email, null, 'column.renamed',
        { column_id: req.params.id, changed: b });
      res.json({ column: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

app.put('/api/kanban/columns/reorder',
  requireRole('boss'),
  async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.column_ids) ? req.body.column_ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'column_ids required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `UPDATE ops.kanban_columns SET position = $1
            WHERE id = $2 AND deleted_at IS NULL`,
          [i, ids[i]]
        );
      }
      await client.query('COMMIT');
      await logActivity(req.user!.email, null, 'column.reordered', { order: ids });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    } finally {
      client.release();
    }
  }
);

app.delete('/api/kanban/columns/:id',
  requireRole('boss'),
  async (req, res) => {
    try {
      // Refuse to delete a column that still has live cards.
      const cardsLeft = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ops.kanban_cards
          WHERE column_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (cardsLeft[0].n > 0) {
        return res.status(409).json({ error: 'column_not_empty', cards: cardsLeft[0].n });
      }
      const rows = await query(
        `UPDATE ops.kanban_columns SET deleted_at = now()
          WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, name`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      await logActivity(req.user!.email, null, 'column.deleted', rows[0] as Record<string, unknown>);
      res.json({ deleted: rows[0] });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Staff activity feed ------------------------------------ //
// Used by the Activity page — combines kanban_activity with actions_log.
// `subscriber_id` query filters activity where a specific member is the
// subject (either assigned a card or named in the payload).
app.get('/api/activity', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const actor = (req.query.actor as string || '').trim().toLowerCase();
  const subscriber = (req.query.subscriber_id as string || '').trim();
  const since = (req.query.since as string || '').trim();
  try {
    const kanbanWhere: string[] = [];
    const kanbanVals: unknown[] = [];
    if (actor) {
      kanbanVals.push(actor);
      kanbanWhere.push(`a.actor_email = $${kanbanVals.length}`);
    }
    if (subscriber) {
      kanbanVals.push(subscriber);
      kanbanWhere.push(
        `(a.payload->>'subscriber_id' = $${kanbanVals.length}
          OR a.payload->'assignees' ? $${kanbanVals.length}
          OR EXISTS (SELECT 1 FROM ops.kanban_assignees ka
                      WHERE ka.card_id = a.card_id
                        AND ka.subscriber_id = $${kanbanVals.length}::uuid))`
      );
    }
    if (since) {
      kanbanVals.push(since);
      kanbanWhere.push(`a.created_at >= $${kanbanVals.length}::timestamptz`);
    }
    kanbanVals.push(limit);
    const kanban = await query(
      `SELECT a.id::text AS id, a.card_id, c.title AS card_title,
              a.actor_email, a.action, a.payload, a.created_at,
              'kanban' AS source
         FROM ops.kanban_activity a
    LEFT JOIN ops.kanban_cards c ON c.id = a.card_id
        ${kanbanWhere.length ? `WHERE ${kanbanWhere.join(' AND ')}` : ''}
        ORDER BY a.created_at DESC
        LIMIT $${kanbanVals.length}`,
      kanbanVals
    );
    res.json({ events: kanban });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// Free-form Q&A over the team's recent reports. Boss/PA only since the
// data is sensitive. Pulls last `days` of reports (default 14, max 60),
// hands them to Claude with the boss's question, returns a plain prose
// answer. Cheaper model than /api/agent/summary because the question is
// usually narrow.
app.post('/api/agent/ask-reports',
  requireRole('boss', 'pa'),
  async (req, res) => {
    const question = ((req.body?.question as string) || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'question required' });
    const days = Math.min(60, Math.max(1, Number(req.body?.days ?? 14)));
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    try {
      const rows = await query(
        `SELECT s.name AS subscriber, s.role,
                to_char(d.report_date, 'YYYY-MM-DD') AS date,
                d.goals, d.mid_progress, d.mid_issues, d.mid_changes,
                d.eod_completed, d.eod_unfinished, d.eod_hours
           FROM ops.daily_reports d
           JOIN ops.report_subscribers s ON s.id = d.subscriber_id
          WHERE d.report_date >= (now() - ($1 || ' days')::interval)::date
          ORDER BY d.report_date DESC, s.name`,
        [String(days)]
      );
      const system =
        "You are a senior operations analyst answering a question about a small " +
        "team's recent daily reports. Each report has the subscriber's name, " +
        "role, date, and slot fields (morning goals, mid-day progress/issues, " +
        "end-of-day completed/unfinished/hours). Answer the boss's question in " +
        "plain prose, cite names and dates, keep it under 200 words. If the " +
        "data doesn't contain the answer, say so directly — do not hallucinate.";
      const userMessage =
        `Last ${days} days of reports (JSON):\n\n` +
        JSON.stringify(rows, null, 2) +
        `\n\nQuestion: ${question}`;
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await upstream.json().catch(() => ({} as Record<string, unknown>));
      if (!upstream.ok) {
        return res.status(502).json({ error: 'anthropic_error', detail: data });
      }
      const answer =
        (data as { content?: Array<{ text?: string }> })?.content?.[0]?.text
        || '(empty answer)';
      res.json({ answer, rows: rows.length, days });
    } catch (e) {
      res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
    }
  }
);

// ---------- Messages ---------------------------------------------- //
// Raw Telegram message log (both directions). LEFT JOINs the subscriber
// table so consumers can render a name instead of a raw numeric chat_id;
// unknown chats (Ed's own DMs to test bots, stray group chats, etc.)
// still show up, just without a name.
app.get('/api/messages/recent', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 50)));
  const chatIdRaw = (req.query.chat_id as string | undefined)?.trim() || null;
  // Reject non-numeric chat_ids early — filter-by-subscriber-id path
  // in the UI already resolves to a numeric chat_id, so anything else
  // is user error, not a wild chat we want to surface.
  if (chatIdRaw && !/^-?\d+$/.test(chatIdRaw)) {
    return res.status(400).json({ error: 'chat_id must be numeric' });
  }
  const params: unknown[] = [];
  let where = '';
  if (chatIdRaw) {
    params.push(chatIdRaw);
    where = `WHERE m.chat_id = $${params.length}`;
  }
  params.push(limit);
  // messages.chat_id is `text`, report_subscribers.telegram_chat_id is
  // `bigint` — cast on the subscriber side so the join planner can still
  // use the subscriber's PK index.
  try {
    const rows = await query(
      `SELECT m.id, m.chat_id, m.text, m.direction, m.ts,
              s.name AS subscriber_name, s.role AS subscriber_role
         FROM ops.messages m
    LEFT JOIN ops.report_subscribers s ON s.telegram_chat_id::text = m.chat_id
        ${where}
        ORDER BY m.ts DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ messages: rows });
  } catch (e) {
    res.status(pgErrorStatus(e)).json({ error: (e as Error).message });
  }
});

// ---------- Static frontend --------------------------------------- //
const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));

app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[teamscope] unhandled:', err);
  res.status(500).json({ error: 'internal_error' });
});

ensureSchema()
  .then(() => {
    app.listen(Number(PORT), () => {
      console.log(`[teamscope] listening on :${PORT}  env=${NODE_ENV}`);
    });
  })
  .catch(err => {
    console.error('[teamscope] FATAL: schema bootstrap failed', err);
    process.exit(1);
  });
