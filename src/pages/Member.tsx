import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Save, PauseCircle, PlayCircle, Trash2, Send, Check,
  Loader2, AlertTriangle, ExternalLink, Sun, Clock, Moon,
  Calendar, Kanban, MessageSquare, Zap,
  ArrowDownLeft, ArrowUpRight, MessageCircle,
  DollarSign, X, Plane, FileBarChart, Flame, Copy, Handshake, CircleDashed,
} from 'lucide-react';
import { apiFetch, apiGet, Me } from '../auth';

// Matches the server shape returned by GET /api/team/subscribers/:id.
interface Subscriber {
  id: string; telegram_chat_id: number; name: string;
  role: string | null; timezone: string;
  email?: string | null;
  language: 'zh' | 'en';
  slot_morning: string; slot_midday: string; slot_eod: string;
  working_days: number[]; active: boolean;
  created_at: string; updated_at?: string;
}
interface RecentReport {
  report_date: string;
  goals: string | null;
  mid_progress: string | null; mid_issues: string | null;
  eod_completed: string | null; eod_unfinished: string | null;
  eod_hours: number | null;
  updated_at: string;
}
interface Column { id: string; name: string; is_done: boolean }
interface Card {
  id: string; column_id: string; title: string;
  priority: string; due_date: string | null;
  done_at: string | null;
}
interface Assignee { card_id: string; subscriber_id: string }
interface TemplateMap { [slot: string]: { text: string; updated_at: string } }
interface TelegramMsg {
  id: string; chat_id: number; text: string;
  direction: 'in' | 'out'; ts: string;
  subscriber_name: string | null;
}

// Shared time format helpers (Postgres `time` is "HH:MM:SS", HTML input wants "HH:MM").
const toHHMM = (v: string | undefined) => (v ?? '').slice(0, 5);
const toHHMMSS = (v: string) => (v.length === 5 ? `${v}:00` : v);

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const TZ_OPTIONS = [
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Hong_Kong',
  'Asia/Taipei', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Los_Angeles', 'UTC',
];

export default function Member({ me, subscriberId, onBack }: {
  me: Me;
  subscriberId: string;
  onBack: () => void;
}) {
  const isBoss = me.role === 'boss';
  const [sub, setSub] = useState<Subscriber | null>(null);
  const [reports, setReports] = useState<RecentReport[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [columns, setColumns] = useState<Map<string, Column>>(new Map());
  const [templates, setTemplates] = useState<TemplateMap | null>(null);
  const [messages, setMessages] = useState<TelegramMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await apiGet<{ subscriber: Subscriber; recent_reports: RecentReport[] }>(
        `/api/team/subscribers/${subscriberId}`
      );
      setSub(detail.subscriber);
      setReports(detail.recent_reports);
      setErr(null);
    } catch (e) { setErr(String(e)); setSub(null); }
    finally { setLoading(false); }

    // Side channels — if they fail, the page still renders the core subscriber info.
    try {
      const board = await apiGet<{
        cards: Card[]; assignees: Assignee[]; columns: Column[];
      }>('/api/kanban/board');
      const colMap = new Map<string, Column>();
      board.columns.forEach(c => colMap.set(c.id, c));
      setColumns(colMap);
      const mine = new Set(
        board.assignees.filter(a => a.subscriber_id === subscriberId).map(a => a.card_id)
      );
      setCards(board.cards.filter(c => mine.has(c.id)));
    } catch {/* show empty state below */}
    try {
      const t = await apiGet<{ templates: TemplateMap }>('/api/config/prompt-templates');
      setTemplates(t.templates);
    } catch {/* ditto */}
  }, [subscriberId]);

  // Fetched separately because it needs the resolved chat_id and is
  // cheap enough to re-pull on every member switch.
  useEffect(() => {
    if (!sub?.telegram_chat_id) return;
    apiGet<{ messages: TelegramMsg[] }>(
      `/api/messages/recent?chat_id=${sub.telegram_chat_id}&limit=30`
    )
      .then(d => setMessages(d.messages))
      .catch(() => setMessages([]));
  }, [sub?.telegram_chat_id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !sub) {
    return <div className="p-10 text-center text-slate-400">Loading member…</div>;
  }
  if (!sub) {
    return (
      <div className="p-10 text-center space-y-3">
        <div className="text-rose-600">{err || 'Member not found.'}</div>
        <button onClick={onBack}
          className="text-sm text-indigo-600 hover:text-indigo-800">← Back to Team</button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
        <MemberHeader sub={sub} onBack={onBack} />
        <ScheduleCard sub={sub} isBoss={isBoss} onSaved={load} />
        <SalaryCard sub={sub} isBoss={isBoss} />
        <div className="grid gap-6 md:grid-cols-2">
          <TemplatesCard templates={templates} onOpenTeam={onBack} />
          <ActionsCard sub={sub} isBoss={isBoss}
            onChanged={load} onDeleted={onBack} />
        </div>
        <PromiseTrackerCard subscriberId={sub.id} />
        <RecentReportsCard reports={reports} />
        <MonthlyReviewCard sub={sub} />
        <TelegramMessagesCard messages={messages} />
        <AssignedCardsCard cards={cards} columns={columns} />
      </div>
    </div>
  );
}

function MonthlyReviewCard({ sub }: { sub: Subscriber }) {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true); setErr(null); setSummary(null);
    try {
      const res = await apiFetch(
        `/api/team/subscribers/${sub.id}/monthly-summary?month=${month}`,
        { method: 'POST' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      setSummary((body as { summary: string }).summary);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!summary) return;
    await navigator.clipboard.writeText(summary).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card title="Monthly review" icon={<FileBarChart className="w-4 h-4 text-indigo-500" />}>
      <p className="text-xs text-slate-500 mb-3">
        Claude reads {sub.name}'s daily reports + assigned board cards for the
        chosen month and writes a one-page review.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={generate} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                     bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
          Generate review
        </button>
      </div>
      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
          {err}
        </div>
      )}
      {summary && (
        <div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm
                          text-slate-700 leading-relaxed whitespace-pre-line max-h-96 overflow-y-auto">
            {summary}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={copy}
              className="inline-flex items-center gap-1.5 text-xs font-medium
                         text-slate-600 hover:text-slate-900 px-2 py-1 rounded">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- Salary card --------------------------------------------- //
interface SalaryConfig {
  payment_type: 'monthly_base' | 'hourly' | 'daily_rate';
  rate: string | number;
  currency: string;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}
interface SalaryPayment {
  id: string; period_start: string; period_end: string;
  days_reported: number | null; hours_reported: string | null;
  amount: string; currency: string;
  paid_at: string; paid_by: string | null; notes: string | null;
}
interface SalaryPeriod {
  working_days_in_period: number;
  leave_days?: number;
  public_holidays?: number;
  days_reported: number;
  days_missed: number;
  hours_reported: number;
  amount_owed: number;
  already_paid: number;
  net_due: number;
  currency: string;
  config: SalaryConfig | null;
}
interface LeaveDay {
  leave_date: string; kind: string; note: string | null; created_by: string | null;
}
interface Streak {
  current: number; longest_30d: number; missed_30d: number;
}

function SalaryCard({ sub, isBoss }: { sub: Subscriber; isBoss: boolean }) {
  const [config, setConfig] = useState<SalaryConfig | null>(null);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [period, setPeriod] = useState<SalaryPeriod | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [leaveDays, setLeaveDays] = useState<LeaveDay[]>([]);
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(todayLocalISO());
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [managingLeave, setManagingLeave] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const c = await apiGet<{ config: SalaryConfig | null; recent_payments: SalaryPayment[] }>(
        `/api/team/subscribers/${sub.id}/salary`
      );
      setConfig(c.config); setPayments(c.recent_payments);
    } catch {/* silent */}
    try {
      const p = await apiGet<SalaryPeriod>(
        `/api/salary/period?subscriber_id=${sub.id}&from=${from}&to=${to}`
      );
      setPeriod(p);
    } catch (e) { setErr(String(e)); }
    try {
      const s = await apiGet<Streak>(`/api/team/subscribers/${sub.id}/streak`);
      setStreak(s);
    } catch {/* silent */}
    try {
      const l = await apiGet<{ leave: LeaveDay[] }>(`/api/team/subscribers/${sub.id}/leave`);
      setLeaveDays(l.leave);
    } catch {/* silent */}
  }, [sub.id, from, to]);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <Card title="Salary" icon={<DollarSign className="w-4 h-4 text-emerald-500" />}>
      {/* Streak chip always renders when data is in — even for members
          without configured salary terms (interns, new joiners). */}
      {streak && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                           bg-amber-50 text-amber-800 text-xs font-medium border border-amber-200">
            <Flame className="w-3 h-3" />
            {streak.current}d streak · {streak.missed_30d} missed in 30d
          </span>
        </div>
      )}
      {!config ? (
        <p className="text-sm text-slate-500 mb-3">
          No salary terms configured.{!isBoss && ' Ask the boss to set one.'}
        </p>
      ) : (
        <div className="text-sm text-slate-700 mb-4 flex items-center gap-3 flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
            {config.payment_type.replace('_', ' ')}
          </span>
          <span className="font-semibold text-slate-900">
            {config.currency} {Number(config.rate).toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">
            {config.payment_type === 'monthly_base' && 'per month'}
            {config.payment_type === 'hourly'       && 'per reported hour'}
            {config.payment_type === 'daily_rate'   && 'per reported day'}
          </span>
          {config.updated_at && (
            <span className="text-[11px] text-slate-400">
              · updated {new Date(config.updated_at).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-center">
        <SalaryStat label="Working days" value={period?.working_days_in_period ?? '—'} />
        <SalaryStat label="Days reported" value={period?.days_reported ?? '—'} />
        <SalaryStat label="Hours reported" value={period?.hours_reported?.toFixed(1) ?? '—'} />
        <SalaryStat label="Days missed"
          value={period?.days_missed ?? '—'}
          tone={period && period.days_missed > 0 ? 'rose' : 'default'} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span>Period:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-slate-200 rounded px-2 py-0.5 text-xs bg-white" />
          <span>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-slate-200 rounded px-2 py-0.5 text-xs bg-white" />
        </div>
        {period && config && (
          <div className="text-right">
            <div className="text-xs text-slate-500">Net due</div>
            <div className="text-lg font-bold text-slate-900">
              {period.currency} {period.net_due.toLocaleString()}
            </div>
            {period.already_paid > 0 && (
              <div className="text-[11px] text-slate-400">
                of {period.amount_owed.toLocaleString()} (paid {period.already_paid.toLocaleString()})
              </div>
            )}
          </div>
        )}
      </div>

      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3">{err}</div>}

      {isBoss && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                       bg-slate-900 hover:bg-slate-800 text-white rounded-lg">
            <DollarSign className="w-3.5 h-3.5" /> {config ? 'Edit salary' : 'Set salary'}
          </button>
          {config && period && period.net_due > 0 && (
            <button onClick={() => setPaying(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
              <Check className="w-3.5 h-3.5" /> Mark paid
            </button>
          )}
          <button onClick={() => setManagingLeave(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                       bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg">
            <Plane className="w-3.5 h-3.5" /> Leave & holidays
            {(period?.leave_days ?? 0) > 0 && (
              <span className="ml-1 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px]">
                {period?.leave_days} in window
              </span>
            )}
          </button>
        </div>
      )}

      {payments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Recent payments
          </h4>
          <ul className="divide-y divide-slate-100 text-xs">
            {payments.map(p => (
              <li key={p.id} className="py-1.5 flex items-center justify-between">
                <span className="text-slate-700">
                  {p.period_start} → {p.period_end}
                  {p.days_reported != null && <> · {p.days_reported}d</>}
                </span>
                <span className="font-semibold text-slate-800">
                  {p.currency} {Number(p.amount).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && isBoss && (
        <SalaryEditModal sub={sub} initial={config}
          onDone={() => { setEditing(false); loadAll(); }}
          onClose={() => setEditing(false)} />
      )}
      {paying && isBoss && period && (
        <SalaryPayModal sub={sub}
          defaultFrom={from} defaultTo={to} defaultAmount={period.net_due}
          defaultCurrency={period.currency}
          onDone={() => { setPaying(false); loadAll(); }}
          onClose={() => setPaying(false)} />
      )}
      {managingLeave && isBoss && (
        <LeaveManagerModal sub={sub} leaveDays={leaveDays}
          onDone={() => loadAll()}
          onClose={() => setManagingLeave(false)} />
      )}
    </Card>
  );
}

function LeaveManagerModal({ sub, leaveDays, onDone, onClose }: {
  sub: Subscriber;
  leaveDays: LeaveDay[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [draftDate, setDraftDate] = useState('');
  const [kind, setKind] = useState('leave');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(leaveDays);

  useEffect(() => { setDays(leaveDays); }, [leaveDays]);

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftDate)) { setErr('Pick a date'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}/leave`, {
        method: 'POST',
        body: JSON.stringify({ leave_date: draftDate, kind }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `HTTP ${res.status}`);
      }
      const fresh = await apiGet<{ leave: LeaveDay[] }>(`/api/team/subscribers/${sub.id}/leave`);
      setDays(fresh.leave);
      setDraftDate('');
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(d: string) {
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/team/subscribers/${sub.id}/leave/${d}`, { method: 'DELETE' });
      const fresh = await apiGet<{ leave: LeaveDay[] }>(`/api/team/subscribers/${sub.id}/leave`);
      setDays(fresh.leave);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{sub.name} · Leave & holidays</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500">
            Days marked here are excluded from missed-slot count and salary deductions.
          </p>
          <div className="flex items-center gap-2">
            <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <select value={kind} onChange={e => setKind(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
              <option value="leave">Leave</option>
              <option value="sick">Sick</option>
              <option value="unpaid">Unpaid</option>
              <option value="public_holiday">Public holiday</option>
              <option value="other">Other</option>
            </select>
            <button onClick={add} disabled={busy || !draftDate}
              className="px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                         disabled:opacity-40 text-white rounded-lg">
              Add
            </button>
          </div>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
          {days.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No leave days yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {days.map(d => (
                <li key={d.leave_date} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-slate-800">{d.leave_date}</span>
                  <span className="text-xs text-slate-500">{d.kind}</span>
                  <button onClick={() => remove(d.leave_date)} disabled={busy}
                    className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function SalaryStat({ label, value, tone = 'default' }: {
  label: string; value: React.ReactNode; tone?: 'default' | 'rose';
}) {
  return (
    <div className={`p-2 rounded-lg border ${
      tone === 'rose'
        ? 'bg-rose-50 border-rose-100 text-rose-700'
        : 'bg-slate-50 border-slate-100 text-slate-700'
    }`}>
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}

function SalaryEditModal({ sub, initial, onDone, onClose }: {
  sub: Subscriber;
  initial: SalaryConfig | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [paymentType, setPaymentType] = useState<SalaryConfig['payment_type']>(
    initial?.payment_type ?? 'monthly_base'
  );
  const [rate, setRate] = useState(String(initial?.rate ?? ''));
  const [currency, setCurrency] = useState(initial?.currency ?? 'SGD');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}/salary`, {
        method: 'PUT',
        body: JSON.stringify({
          payment_type: paymentType,
          rate: Number(rate),
          currency,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Salary for ${sub.name}`} onSubmit={save} onClose={onClose} busy={busy} err={err}>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Payment type</span>
        <select value={paymentType} onChange={e => setPaymentType(e.target.value as typeof paymentType)}
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="monthly_base">Monthly base</option>
          <option value="hourly">Hourly (× reported hours)</option>
          <option value="daily_rate">Daily rate (× reported days)</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">
            Rate ({paymentType === 'monthly_base' ? 'per month' :
                   paymentType === 'hourly' ? 'per hour' : 'per day'})
          </span>
          <input type="number" step="0.01" required value={rate}
            onChange={e => setRate(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Currency</span>
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {['SGD', 'MYR', 'HKD', 'USD', 'CNY', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="optional"
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      </label>
    </ModalShell>
  );
}

function SalaryPayModal({ sub, defaultFrom, defaultTo, defaultAmount, defaultCurrency, onDone, onClose }: {
  sub: Subscriber;
  defaultFrom: string; defaultTo: string;
  defaultAmount: number; defaultCurrency: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [currency, setCurrency] = useState(defaultCurrency);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}/salary/pay`, {
        method: 'POST',
        body: JSON.stringify({
          period_start: from, period_end: to,
          amount: Number(amount), currency, notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Mark paid — ${sub.name}`} onSubmit={save} onClose={onClose}
      busy={busy} err={err} submitLabel="Record payment">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Period start</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Period end</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Amount</span>
          <input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Currency</span>
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {['SGD','MYR','HKD','USD','CNY','EUR','GBP'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">Notes</span>
        <input value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="e.g. paid via bank transfer Apr 30"
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
      </label>
    </ModalShell>
  );
}

function ModalShell({ title, onSubmit, onClose, busy, err, children, submitLabel = 'Save' }: {
  title: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  busy: boolean;
  err: string | null;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={onSubmit}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-5 space-y-3 overflow-y-auto">{children}
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="px-3 py-1.5 text-sm font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {busy ? 'Saving…' : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

function thirtyDaysAgo(): string {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TelegramMessagesCard({ messages }: { messages: TelegramMsg[] }) {
  return (
    <Card title={`Recent Telegram messages (${messages.length})`}
      icon={<MessageCircle className="w-4 h-4 text-indigo-500" />}>
      {messages.length === 0 ? (
        <p className="text-sm text-slate-400">
          No Telegram history with this chat_id yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {messages.map(m => {
            const isIn = m.direction === 'in';
            return (
              <li key={m.id} className="py-2.5 flex items-start gap-2.5">
                <div className={`w-6 h-6 rounded-full grid place-items-center flex-shrink-0 mt-0.5
                  ${isIn ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                  {isIn
                    ? <ArrowDownLeft className="w-3 h-3" />
                    : <ArrowUpRight className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-slate-500 mb-0.5">
                    {isIn ? 'from member' : 'from @edpapabot'}
                    <span className="ml-2">
                      {new Date(m.ts).toLocaleString(undefined,
                        { month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {m.text || <em className="text-slate-400">(no text)</em>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------- Header ---------------------------------------------------- //
function MemberHeader({ sub, onBack }: { sub: Subscriber; onBack: () => void }) {
  const initials = sub.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const bg = colorFromId(sub.id);
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-4">
        <button onClick={onBack}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-14 h-14 rounded-2xl grid place-items-center text-white font-bold text-lg"
             style={{ backgroundColor: bg }}>
          {initials}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{sub.name}</h1>
          <p className="text-sm text-slate-500 font-medium">
            {sub.role || 'team'} · {sub.timezone} · Telegram <span className="font-mono">@{sub.telegram_chat_id}</span>
          </p>
        </div>
      </div>
      <span className={`text-xs px-3 py-1 rounded-full font-medium ${
        sub.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
      }`}>{sub.active ? 'Active' : 'Paused'}</span>
    </header>
  );
}

function colorFromId(id: string): string {
  const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
                   '#14b8a6', '#ec4899', '#0ea5e9', '#84cc16', '#f97316'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---------- Schedule editor ------------------------------------------ //
function ScheduleCard({ sub, isBoss, onSaved }: {
  sub: Subscriber; isBoss: boolean; onSaved: () => void;
}) {
  const [morning, setMorning] = useState(toHHMM(sub.slot_morning));
  const [midday, setMidday]   = useState(toHHMM(sub.slot_midday));
  const [eod, setEod]         = useState(toHHMM(sub.slot_eod));
  const [tz, setTz]           = useState(sub.timezone);
  const [days, setDays]       = useState<number[]>(sub.working_days ?? []);
  const [active, setActive]   = useState(sub.active);
  const [language, setLanguage] = useState<'zh' | 'en'>(sub.language ?? 'zh');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Re-sync if the parent re-fetches.
  useEffect(() => {
    setMorning(toHHMM(sub.slot_morning));
    setMidday(toHHMM(sub.slot_midday));
    setEod(toHHMM(sub.slot_eod));
    setTz(sub.timezone);
    setDays(sub.working_days ?? []);
    setActive(sub.active);
    setLanguage(sub.language ?? 'zh');
  }, [sub.updated_at, sub.id]);

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          slot_morning: toHHMMSS(morning),
          slot_midday: toHHMMSS(midday),
          slot_eod: toHHMMSS(eod),
          timezone: tz,
          working_days: days,
          active,
          language,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Report schedule" icon={<Calendar className="w-4 h-4 text-indigo-500" />}>
      <p className="text-xs text-slate-500 mb-4">
        When @edpapabot DMs this member for each slot. Times are in the member's timezone; only
        sends on their selected working days.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SlotInput label="Morning" icon={<Sun className="w-3.5 h-3.5 text-amber-500" />}
          value={morning} onChange={setMorning} disabled={!isBoss} />
        <SlotInput label="Midday" icon={<Clock className="w-3.5 h-3.5 text-sky-500" />}
          value={midday} onChange={setMidday} disabled={!isBoss} />
        <SlotInput label="End of day" icon={<Moon className="w-3.5 h-3.5 text-indigo-500" />}
          value={eod} onChange={setEod} disabled={!isBoss} />
      </div>
      <div className="grid md:grid-cols-[1fr_280px] gap-4 mb-4">
        <Field label="Working days">
          <div className="flex gap-1.5">
            {ALL_DAYS.map(d => {
              const on = days.includes(d);
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  disabled={!isBoss}
                  className={`flex-1 text-xs py-1.5 rounded-lg border transition
                    disabled:cursor-not-allowed disabled:opacity-60
                    ${on
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Timezone">
          <select value={tz} onChange={e => setTz(e.target.value)} disabled={!isBoss}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white
                       disabled:bg-slate-50 disabled:text-slate-500">
            {TZ_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Bot language" hint="DMs go out in this language. Replies are auto-translated to English when stored.">
        <div className="flex gap-2 mb-4">
          {(['zh', 'en'] as const).map(lng => {
            const on = language === lng;
            return (
              <button key={lng} type="button" onClick={() => setLanguage(lng)}
                disabled={!isBoss}
                className={`flex-1 text-sm py-2 rounded-lg border transition
                  disabled:cursor-not-allowed disabled:opacity-60
                  ${on
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                {lng === 'zh' ? '中文' : 'English'}
              </button>
            );
          })}
        </div>
      </Field>
      <label className="flex items-center gap-2 mb-4">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
          disabled={!isBoss} className="rounded border-slate-300" />
        <span className="text-sm text-slate-700">
          Active — receives daily-report DMs
        </span>
      </label>
      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3">{err}</div>}
      {isBoss && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium
                       bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg">
            <Save className="w-4 h-4" />
            {busy ? 'Saving…' : 'Save schedule'}
          </button>
          {justSaved && (
            <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

const SlotInput = ({ label, icon, value, onChange, disabled }: {
  label: string; icon: React.ReactNode; value: string;
  onChange: (v: string) => void; disabled?: boolean;
}) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-700 inline-flex items-center gap-1">
      {icon} {label}
    </span>
    <input type="time" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono
                 disabled:bg-slate-50 disabled:text-slate-500" />
  </label>
);

// ---------- Templates view + actions --------------------------------- //
function TemplatesCard({ templates, onOpenTeam }: {
  templates: TemplateMap | null; onOpenTeam: () => void;
}) {
  return (
    <Card title="Report templates" icon={<MessageSquare className="w-4 h-4 text-indigo-500" />}>
      <p className="text-xs text-slate-500 mb-3">
        Currently global across the whole team. Per-member overrides aren't wired yet.
      </p>
      {!templates ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : (
        <ul className="space-y-2">
          {(['morning', 'midday', 'eod'] as const).map(slot => (
            <li key={slot} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                {slot === 'eod' ? 'End of day' : slot}
              </div>
              <pre className="text-[11px] text-slate-700 font-mono whitespace-pre-wrap leading-snug">
                {(templates[slot]?.text ?? '(not set)').slice(0, 220)}
              </pre>
            </li>
          ))}
        </ul>
      )}
      <button onClick={onOpenTeam}
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-900">
        Edit on Team page <ExternalLink className="w-3 h-3" />
      </button>
    </Card>
  );
}

function ActionsCard({ sub, isBoss, onChanged, onDeleted }: {
  sub: Subscriber; isBoss: boolean;
  onChanged: () => void; onDeleted: () => void;
}) {
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState<'sent' | 'disabled' | 'failed' | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function testPing() {
    setPingBusy(true); setErr(null); setPingResult(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}/test-ping`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      setPingResult((body as { outcome: 'sent' | 'disabled' | 'failed' }).outcome);
    } catch (e) { setErr((e as Error).message); }
    finally { setPingBusy(false); }
  }

  async function toggle() {
    setToggleBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}/toggle`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setToggleBusy(false); }
  }

  async function remove() {
    setDelBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${sub.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted();
    } catch (e) { setErr((e as Error).message); setDelBusy(false); }
  }

  return (
    <Card title="Actions" icon={<Zap className="w-4 h-4 text-indigo-500" />}>
      {!isBoss ? (
        <p className="text-sm text-slate-400">Boss-only.</p>
      ) : (
        <div className="space-y-2">
          <ActionButton onClick={testPing} busy={pingBusy}
            icon={<Send className="w-4 h-4" />} label="Send test DM"
            help={
              pingResult === 'sent'     ? 'DM sent ✓' :
              pingResult === 'disabled' ? 'TELEGRAM_BOT_TOKEN not configured' :
              pingResult === 'failed'   ? 'Send failed — see server log' :
              'Dispatches a short "can you see this?" DM to their chat_id'
            } />
          <ActionButton onClick={toggle} busy={toggleBusy}
            icon={sub.active
              ? <PauseCircle className="w-4 h-4" />
              : <PlayCircle className="w-4 h-4" />}
            label={sub.active ? 'Pause daily DMs' : 'Resume daily DMs'}
            help={sub.active
              ? 'Stops the 3× slot prompts without deleting history'
              : 'Re-enable the 3× slot prompts'} />
          {!confirmDel ? (
            <ActionButton onClick={() => setConfirmDel(true)} busy={false}
              danger
              icon={<Trash2 className="w-4 h-4" />} label="Delete subscriber"
              help="Removes from the roster. Reports stay, but slot DMs stop." />
          ) : (
            <div className="flex items-center gap-2 p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4" />
              Delete <b>{sub.name}</b>?
              <button onClick={remove} disabled={delBusy}
                className="ml-auto px-2 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded">
                {delBusy ? '…' : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmDel(false)}
                className="px-2 py-1 text-slate-600 hover:bg-slate-200 rounded">
                Cancel
              </button>
            </div>
          )}
          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
      )}
    </Card>
  );
}

function ActionButton({ onClick, busy, icon, label, help, danger = false }: {
  onClick: () => void; busy: boolean;
  icon: React.ReactNode; label: string; help?: string; danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`w-full text-left p-3 border rounded-lg transition disabled:opacity-50
        ${danger
          ? 'border-rose-200 hover:border-rose-300 hover:bg-rose-50 text-rose-700'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon} {label}
      </div>
      {help && <div className="text-xs text-slate-500 mt-0.5 pl-6">{help}</div>}
    </button>
  );
}

// ---------- Promise tracker (today's morning goals → done) ----------- //
// One source of truth for "did this member keep what they promised
// today?" Loaded for today's date specifically; lists each parsed goal
// with status icons. Boss can manually toggle done for goals never
// carded (verbal completions). Hidden when there's no morning report.
interface GoalItem {
  id: string;
  position: number;
  text: string;
  card_id: string | null;
  card_done: boolean;
  card_column_id: string | null;
  manually_done: boolean;
  done: boolean;
}

function PromiseTrackerCard({ subscriberId }: { subscriberId: string }) {
  const [items, setItems] = useState<GoalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasReport, setHasReport] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // First find today's report id for this subscriber.
      const today = new Date().toISOString().slice(0, 10);
      const r = await apiGet<{ reports: Array<{ id: string; subscriber_id: string; report_date: string }> }>(
        `/api/reports/recent?days=1`
      );
      const mine = (r.reports || []).find(rr =>
        rr.subscriber_id === subscriberId && rr.report_date === today);
      if (!mine) {
        setHasReport(false);
        setItems([]);
        return;
      }
      setHasReport(true);
      const data = await apiGet<{ items: GoalItem[] }>(
        `/api/reports/${mine.id}/goal-items`
      );
      setItems(data.items || []);
    } catch {
      setItems([]); setHasReport(false);
    } finally { setLoading(false); }
  }, [subscriberId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(itemId: string) {
    setBusyId(itemId);
    try {
      await apiFetch(`/api/report-goal-items/${itemId}/toggle-done`, { method: 'POST' });
      await load();
    } finally { setBusyId(null); }
  }

  const total = items.length;
  const kept = items.filter(i => i.done).length;
  const pct = total === 0 ? 0 : Math.round((kept / total) * 100);

  if (loading) {
    return (
      <Card title="Today's promises" icon={<Handshake className="w-4 h-4 text-indigo-500" />}>
        <p className="text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }
  if (!hasReport || total === 0) {
    return (
      <Card title="Today's promises" icon={<Handshake className="w-4 h-4 text-indigo-500" />}>
        <p className="text-sm text-slate-400">
          No morning goals filed today yet — promises tracker will show up once goals are in.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Today's promises" icon={<Handshake className="w-4 h-4 text-indigo-500" />}>
      <div className="flex items-center gap-3 mb-4">
        <div className="text-2xl font-bold text-slate-900">{kept}<span className="text-slate-400 text-base font-normal"> / {total}</span></div>
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${
            pct === 100 ? 'bg-emerald-500' :
            pct >= 50 ? 'bg-amber-500' :
            'bg-slate-400'
          }`} style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-slate-500 tabular-nums">{pct}%</div>
      </div>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-3 text-sm">
            <GoalStatusIcon item={item} />
            <span className={`flex-1 ${item.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
              {item.text}
            </span>
            <button onClick={() => toggle(item.id)} disabled={busyId === item.id}
              className="text-xs text-slate-400 hover:text-slate-700 px-2 py-0.5 rounded hover:bg-slate-100">
              {item.manually_done ? 'undo ✓' : 'mark ✓'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GoalStatusIcon({ item }: { item: GoalItem }) {
  if (item.card_done) {
    return <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" aria-label="Done via card" />;
  }
  if (item.manually_done) {
    return <Check className="w-4 h-4 text-indigo-500 flex-shrink-0" aria-label="Manually marked done" />;
  }
  if (item.card_id) {
    return <CircleDashed className="w-4 h-4 text-amber-500 flex-shrink-0" aria-label="Card open" />;
  }
  return <CircleDashed className="w-4 h-4 text-slate-300 flex-shrink-0" aria-label="No card yet" />;
}

// ---------- Recent reports / assigned cards -------------------------- //
function RecentReportsCard({ reports }: { reports: RecentReport[] }) {
  return (
    <Card title="Recent reports" icon={<Clock className="w-4 h-4 text-indigo-500" />}>
      {reports.length === 0 ? (
        <p className="text-sm text-slate-400">No reports filed yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {reports.map(r => (
            <li key={r.report_date} className="py-3 text-sm">
              <div className="font-medium text-slate-800 mb-1">
                {new Date(r.report_date + 'T00:00:00').toLocaleDateString(undefined,
                  { weekday: 'long', month: 'short', day: 'numeric' })}
                {r.eod_hours != null && (
                  <span className="ml-2 text-xs text-slate-500">{r.eod_hours}h</span>
                )}
              </div>
              <div className="text-xs text-slate-500 space-y-0.5 pl-3">
                {r.goals && <div><b>Goals:</b> {truncate(r.goals, 120)}</div>}
                {r.mid_progress && <div><b>Midday:</b> {truncate(r.mid_progress, 120)}</div>}
                {r.eod_completed && <div><b>Done:</b> {truncate(r.eod_completed, 120)}</div>}
                {r.eod_unfinished && <div className="text-amber-700"><b>Unfinished:</b> {truncate(r.eod_unfinished, 120)}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssignedCardsCard({ cards, columns }: {
  cards: Card[]; columns: Map<string, Column>;
}) {
  const { open, done } = useMemo(() => {
    const o: Card[] = []; const d: Card[] = [];
    for (const c of cards) {
      const col = columns.get(c.column_id);
      (col?.is_done ? d : o).push(c);
    }
    return { open: o, done: d };
  }, [cards, columns]);
  return (
    <Card title={`Board cards assigned (${cards.length})`}
      icon={<Kanban className="w-4 h-4 text-indigo-500" />}>
      {cards.length === 0 ? (
        <p className="text-sm text-slate-400">No cards assigned.</p>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && <CardGroup label="Open" cards={open} columns={columns} />}
          {done.length > 0 && <CardGroup label="Done" cards={done} columns={columns} muted />}
        </div>
      )}
    </Card>
  );
}

function CardGroup({ label, cards, columns, muted }: {
  label: string; cards: Card[]; columns: Map<string, Column>; muted?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {label} ({cards.length})
      </div>
      <ul className="space-y-1.5">
        {cards.map(c => (
          <li key={c.id}
            className={`bg-slate-50 border border-slate-200 rounded-lg px-3 py-2
                        flex items-center justify-between gap-3 text-sm
                        ${muted ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="truncate text-slate-800">{c.title}</div>
              <div className="text-xs text-slate-500">
                {columns.get(c.column_id)?.name || '?'}
                {c.priority !== 'medium' && <> · {c.priority}</>}
                {c.due_date && <> · due {new Date(c.due_date).toLocaleDateString(undefined,
                  { month: 'short', day: 'numeric' })}</>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Small primitives ----------------------------------------- //
function Card({ title, icon, children }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <header className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </label>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
