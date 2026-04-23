/**
 * Teamscope backend: Express server that serves the built Vite frontend
 * AND proxies data requests to Supabase using the service role key.
 *
 * Rationale: Supabase anon key is fine for public read/write but we want
 * server-side filtering + audit. Using service key here with narrow REST
 * routes is safer than exposing it to the browser.
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
  PORT = '3000',
  NODE_ENV = 'production',
} = process.env;

if (!SUPABASE_DB_URL) {
  console.error('[teamscope] FATAL: SUPABASE_DB_URL must be set.');
  process.exit(1);
}

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

const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// ---------- Health ------------------------------------------------- //
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, env: NODE_ENV, ts: new Date().toISOString() });
});

// ---------- Daily reports (Pulse module) --------------------------- //
app.get('/api/reports/today', async (_req, res) => {
  try {
    const rows = await query('SELECT * FROM ops.v_today_reports');
    res.json({ reports: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/reports/recent', async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days ?? 7)));
  try {
    const rows = await query(
      `SELECT id, subscriber_id, report_date, goals,
              mid_progress, mid_issues, mid_changes,
              eod_completed, eod_unfinished, eod_hours, updated_at
         FROM ops.daily_reports
        WHERE report_date >= (now() - ($1 || ' days')::interval)::date
        ORDER BY report_date DESC`,
      [String(days)]
    );
    res.json({ reports: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/subscribers', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, telegram_chat_id, name, role, timezone,
              slot_morning, slot_midday, slot_eod, active, created_at
         FROM ops.report_subscribers
        WHERE active = true
        ORDER BY name`
    );
    res.json({ subscribers: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Tasks / actions (Projects module) ---------------------- //
app.get('/api/tasks/pending', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT correlation_id, kind, status, asked_of, created_at, resolved_at
         FROM ops.pending_actions
        WHERE status IN ('pending','pa_review')
        ORDER BY created_at DESC
        LIMIT 50`
    );
    res.json({ tasks: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/actions/recent', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  try {
    const rows = await query(
      `SELECT id, correlation_id, domain, action, executor, outcome, created_at
         FROM ops.actions_log
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ actions: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Profiles (Admin module) -------------------------------- //
app.get('/api/profiles', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, telegram_chat_id, name, role, timezone, active, created_at
         FROM ops.profiles
        WHERE active = true
        ORDER BY name`
    );
    res.json({ profiles: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Messages feed (Brain module) --------------------------- //
app.get('/api/messages/recent', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  try {
    const rows = await query(
      `SELECT id, chat_id, text, direction, ts
         FROM ops.messages
        ORDER BY ts DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ messages: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Static frontend (Vite build output) -------------------- //
const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));

// SPA fallback: everything that isn't /api/* returns index.html
app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// ---------- Error handler ------------------------------------------ //
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[teamscope] unhandled:', err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(Number(PORT), () => {
  console.log(`[teamscope] listening on :${PORT}  env=${NODE_ENV}`);
});
