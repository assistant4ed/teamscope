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
app.use(express.json({ limit: '1mb' }));

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
    req.path === '/config/roster'
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

// Edit a daily-report row (boss only). Accepts any subset of the
// human-authored fields; nulls are allowed to clear a slot. The n8n
// pipeline won't re-overwrite an edited slot within the same day
// unless the subscriber sends a fresh Telegram reply.
app.patch('/api/reports/:id',
  requireRole('boss'),
  async (req, res) => {
    const id = String(req.params.id);
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
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    vals.push(id);
    try {
      const rows = await query(
        `UPDATE ops.daily_reports SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${vals.length}
        RETURNING id, subscriber_id, to_char(report_date, 'YYYY-MM-DD') AS report_date,
                  goals, mid_progress, mid_issues, mid_changes,
                  eod_completed, eod_unfinished, eod_hours, updated_at`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
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
              to_char(d.report_date, 'YYYY-MM-DD') AS report_date,
              d.goals,
              d.mid_progress, d.mid_issues, d.mid_changes,
              d.eod_completed, d.eod_unfinished, d.eod_hours, d.updated_at
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
  try {
    let sql = `SELECT pa.correlation_id, pa.kind, pa.status, pa.asked_of,
                      pa.created_at, pa.resolved_at, pa.payload,
                      m.text AS origin_text,
                      p.name AS requester_name, p.role AS requester_role
                 FROM ops.pending_actions pa
            LEFT JOIN ops.messages m ON m.id = pa.message_id
            LEFT JOIN ops.profiles p ON p.id = pa.profile_id
                WHERE pa.status IN ('pending','pa_review','in_progress')`;
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
      query(`SELECT id, telegram_chat_id, name, role, timezone,
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

// Update an existing subscriber's editable fields (boss only).
app.patch('/api/team/subscribers/:id',
  requireRole('boss'),
  async (req, res) => {
    const b = req.body || {};
    const allowed = ['name', 'role', 'timezone',
                     'slot_morning', 'slot_midday', 'slot_eod',
                     'working_days', 'active', 'telegram_chat_id'] as const;
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
        RETURNING id, telegram_chat_id, name, role, timezone,
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
          `SELECT id, telegram_chat_id, name, role, timezone,
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
      '  "summary": "<one short line, max 160 chars, plain prose>",\n' +
      `  "structured": ${slotFields[slot]},\n` +
      '  "suggested_task": { "title": "<short>", "details": "<one-line>" }  // ONLY when kind==="task"; omit otherwise\n' +
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
    const rows = await query<{ id: string; name: string; telegram_chat_id: number }>(
      `SELECT id, name, telegram_chat_id
         FROM ops.report_subscribers
        WHERE id = ANY($1::uuid[]) AND active = true`,
      [subscriberIds]
    );
    const link = APP_URL ? `\n\n→ ${APP_URL}` : '';
    const body =
      `📋 *New task assigned*\n\n` +
      `_${escapeMarkdown(card.title)}_${link}`;
    for (const sub of rows) {
      const outcome = await sendTelegramMessage(sub.telegram_chat_id, body);
      console.log(
        `[teamscope] notify ${sub.name} (${sub.telegram_chat_id}) ` +
        `about card ${card.id.slice(0, 8)} → ${outcome} (by ${actorEmail})`
      );
    }
  } catch (e) {
    console.error('[teamscope] notify error:', (e as Error).message);
  }
}

// Telegram Markdown has a narrow safe set; escape the ones the API cares about.
function escapeMarkdown(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
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
app.get('/api/kanban/board', async (_req, res) => {
  try {
    const [columns, cards, assignees, subscribers] = await Promise.all([
      query<{ id: string; name: string; position: number; is_done: boolean; wip_limit: number | null }>(
        `SELECT id, name, position, is_done, wip_limit
           FROM ops.kanban_columns
          WHERE deleted_at IS NULL
          ORDER BY position`
      ),
      query(
        `SELECT id, column_id, title, description, priority, position, due_date,
                created_by, created_at, updated_at, done_at,
                source_kind, source_ref
           FROM ops.kanban_cards
          WHERE deleted_at IS NULL
          ORDER BY column_id, position`
      ),
      query<{ card_id: string; subscriber_id: string; assigned_at: string }>(
        `SELECT a.card_id, a.subscriber_id, a.assigned_at
           FROM ops.kanban_assignees a
           JOIN ops.kanban_cards c ON c.id = a.card_id
          WHERE c.deleted_at IS NULL`
      ),
      query(
        `SELECT id, name, role, timezone, telegram_chat_id, active
           FROM ops.report_subscribers
          ORDER BY active DESC, name`
      ),
    ]);
    res.json({ columns, cards, assignees, subscribers });
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
      const insert = await client.query(
        `INSERT INTO ops.kanban_cards
           (column_id, title, description, priority, position, due_date,
            created_by, source_kind, source_ref)
         VALUES ($1, $2, $3, COALESCE($4, 'medium'), $5, $6, $7,
                 COALESCE($8, 'manual'), $9)
         RETURNING id, column_id, title, description, priority, position,
                   due_date, created_by, created_at, updated_at, done_at,
                   source_kind, source_ref`,
        [columnId, title, b.description ?? null, b.priority ?? null,
         position, b.due_date ?? null, req.user!.email,
         b.source_kind ?? null, b.source_ref ?? null]
      );
      const card = insert.rows[0];
      for (const sid of assigneeIds) {
        await client.query(
          `INSERT INTO ops.kanban_assignees (card_id, subscriber_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [card.id, sid, req.user!.email]
        );
      }
      await client.query('COMMIT');
      await logActivity(req.user!.email, card.id, 'card.created', {
        title: card.title, column_id: card.column_id, assignees: assigneeIds,
      });
      // Fire-and-forget: notify new assignees on Telegram.
      notifyAssignment(assigneeIds, { id: card.id, title: card.title }, req.user!.email);
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
    if (sets.length === 0 && !Array.isArray(b.assignee_ids)) {
      return res.status(400).json({ error: 'no fields to update' });
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
      await client.query('COMMIT');
      const cardId = String(req.params.id);
      await logActivity(req.user!.email, cardId, 'card.updated', {
        changed: Object.fromEntries(fields.filter(k => b[k] !== undefined).map(k => [k, b[k]])),
        ...(Array.isArray(b.assignee_ids) ? { assignees: b.assignee_ids } : {}),
      });
      // Only notify the newly-added assignees so edits don't spam people
      // who were already on the card.
      if (newlyAssigned.length > 0) {
        // card may be null if only assignees changed; fetch title if needed.
        let title = (card?.title as string) || '';
        if (!title) {
          const t = await query<{ title: string }>(
            `SELECT title FROM ops.kanban_cards WHERE id = $1`, [cardId]
          );
          title = t[0]?.title || '(untitled)';
        }
        notifyAssignment(newlyAssigned, { id: cardId, title }, req.user!.email);
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
        for (const title of titles) {
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
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const posRow = await query<{ next_pos: number }>(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
           FROM ops.kanban_columns WHERE deleted_at IS NULL`
      );
      const rows = await query(
        `INSERT INTO ops.kanban_columns (name, position, is_done, wip_limit)
         VALUES ($1, $2, $3, $4)
       RETURNING id, name, position, is_done, wip_limit`,
        [name, posRow[0].next_pos, isDone, wipLimit]
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

// ---------- Messages ---------------------------------------------- //
app.get('/api/messages/recent', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  try {
    const rows = await query(
      `SELECT id, chat_id, text, direction, ts
         FROM ops.messages ORDER BY ts DESC LIMIT $1`,
      [limit]
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
