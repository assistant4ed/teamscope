/**
 * Thin fetch wrapper for the Teamscope backend API.
 * All endpoints live under /api/* (see server/index.ts).
 *
 * Set VITE_API_BASE in .env.local for local dev against a different host;
 * defaults to same-origin (which is what prod serves).
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status} ${body.slice(0, 140)}`);
  }
  return (await res.json()) as T;
}

// ---------- Types mirrored from the backend responses ---------------

export interface TodayReportRow {
  name: string;
  role: string | null;
  report_date: string | null;
  goals: string | null;
  mid_progress: string | null;
  mid_issues: string | null;
  eod_completed: string | null;
  eod_unfinished: string | null;
  eod_hours: number | null;
  missed_slots: string[];
  updated_at: string | null;
}

export interface RecentReportRow {
  id: string;
  subscriber_id: string;
  report_date: string;
  goals: string | null;
  mid_progress: string | null;
  mid_issues: string | null;
  mid_changes: string | null;
  eod_completed: string | null;
  eod_unfinished: string | null;
  eod_hours: number | null;
  updated_at: string;
}

export interface Subscriber {
  id: string;
  telegram_chat_id: number;
  name: string;
  role: string | null;
  timezone: string;
  slot_morning: string;
  slot_midday: string;
  slot_eod: string;
  active: boolean;
  created_at: string;
}

export interface PendingTask {
  correlation_id: string;
  kind: string;
  status: string;
  asked_of: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ActionLogRow {
  id: string;
  correlation_id: string;
  domain: string;
  action: string;
  executor: string;
  outcome: string;
  created_at: string;
}

export interface Profile {
  id: string;
  telegram_chat_id: number | null;
  name: string;
  role: string;
  timezone: string;
  active: boolean;
  created_at: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  text: string;
  direction: 'in' | 'out';
  ts: string;
}

// ---------- Public API ----------------------------------------------

export const api = {
  health: () => get<{ ok: boolean; ts: string }>('/api/health'),

  todayReports: () =>
    get<{ reports: TodayReportRow[] }>('/api/reports/today'),

  recentReports: (days = 7) =>
    get<{ reports: RecentReportRow[] }>(`/api/reports/recent?days=${days}`),

  subscribers: () =>
    get<{ subscribers: Subscriber[] }>('/api/subscribers'),

  pendingTasks: () =>
    get<{ tasks: PendingTask[] }>('/api/tasks/pending'),

  recentActions: (limit = 50) =>
    get<{ actions: ActionLogRow[] }>(`/api/actions/recent?limit=${limit}`),

  profiles: () => get<{ profiles: Profile[] }>('/api/profiles'),

  recentMessages: (limit = 30) =>
    get<{ messages: MessageRow[] }>(`/api/messages/recent?limit=${limit}`),
};
