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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  SUPABASE_DB_URL,
  ALLOWED_USERS = 'hobbychan111@gmail.com:boss',
  PORT = '3000',
  NODE_ENV = 'production',
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
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Reports ------------------------------------------------ //
app.get('/api/reports/today', async (_req, res) => {
  try {
    const rows = await query('SELECT * FROM ops.v_today_reports');
    res.json({ reports: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/reports/recent', async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days ?? 14)));
  try {
    const rows = await query(
      `SELECT d.id, d.subscriber_id, s.name AS subscriber_name, s.role AS subscriber_role,
              d.report_date, d.goals,
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
    res.status(500).json({ error: (e as Error).message });
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
    res.status(500).json({ error: (e as Error).message });
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
      res.status(500).json({ error: (e as Error).message });
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
      res.status(500).json({ error: (e as Error).message });
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
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

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
    res.status(500).json({ error: (e as Error).message });
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
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

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
    res.status(500).json({ error: (e as Error).message });
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

app.listen(Number(PORT), () => {
  console.log(`[teamscope] listening on :${PORT}  env=${NODE_ENV}`);
});
