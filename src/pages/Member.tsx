import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Save, PauseCircle, PlayCircle, Trash2, Send, Check,
  Loader2, AlertTriangle, ExternalLink, Sun, Clock, Moon,
  Calendar, Kanban, MessageSquare, Zap,
} from 'lucide-react';
import { apiFetch, apiGet, Me } from '../auth';

// Matches the server shape returned by GET /api/team/subscribers/:id.
interface Subscriber {
  id: string; telegram_chat_id: number; name: string;
  role: string | null; timezone: string;
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
        <div className="grid gap-6 md:grid-cols-2">
          <TemplatesCard templates={templates} onOpenTeam={onBack} />
          <ActionsCard sub={sub} isBoss={isBoss}
            onChanged={load} onDeleted={onBack} />
        </div>
        <RecentReportsCard reports={reports} />
        <AssignedCardsCard cards={cards} columns={columns} />
      </div>
    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
