import React, { useEffect, useMemo, useState } from 'react';
import {
  Sun, Moon, Clock, Sparkles, Activity, List, Calendar as CalendarIcon,
  Loader2, AlertTriangle, CheckCircle2, User as UserIcon,
  Kanban, ArrowRight, Pencil, Trash2, X, Check, RotateCcw,
  PlusCircle, MessageSquare, Send,
} from 'lucide-react';
import { apiGet, apiPost, apiFetch, Me } from '../auth';

interface Report {
  id: string;
  subscriber_id: string;
  subscriber_name: string;
  subscriber_role: string | null;
  subscriber_email?: string | null;
  report_date: string | null;
  goals: string | null;
  mid_progress: string | null;
  mid_issues: string | null;
  mid_changes: string | null;
  eod_completed: string | null;
  eod_unfinished: string | null;
  eod_hours: number | null;
  created_at?: string;
  updated_at: string;
}

interface SubscriberRef {
  id: string; name: string;
  role: string | null; active: boolean;
}

// Use the viewer's local date, not UTC — a boss in Singapore should
// see their 02:00 SGT log under "Today", not "Yesterday".
const todayLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Accept either "YYYY-MM-DD" or an ISO timestamp; always return a
// stable YYYY-MM-DD or null. Guards against the legacy date
// serialisation that made rows show up as "Invalid Date".
function toISODate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(raw: string | null): string {
  const iso = toISODate(raw);
  if (!iso) return 'No date';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined,
    { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Reports({ me }: { me: Me }) {
  const isBoss = me.role === 'boss';
  const [reports, setReports] = useState<Report[]>([]);
  const [days, setDays] = useState(14);
  const [subFilter, setSubFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [summary, setSummary] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  // report_id → count of cards already imported. Drives the button state
  // so re-clicks (or a reload) can't double-create.
  const [importedById, setImportedById] = useState<Map<string, number>>(new Map());
  const [subscribers, setSubscribers] = useState<SubscriberRef[]>([]);
  const [showManualLog, setShowManualLog] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<{ reports: Report[] }>(`/api/reports/recent?days=${days}`);
      setReports(d.reports);
    } finally { setLoading(false); }
    try {
      const b = await apiGet<{ cards: Array<{ source_kind: string; source_ref: string | null }> }>(
        '/api/kanban/board'
      );
      const m = new Map<string, number>();
      for (const c of b.cards) {
        if (c.source_kind === 'report_goal' && c.source_ref) {
          m.set(c.source_ref, (m.get(c.source_ref) ?? 0) + 1);
        }
      }
      setImportedById(m);
    } catch {/* non-fatal; button just defaults to "Import" state */}
  }
  // Subscribers live independently of the reports window so every active
  // teammate shows up in the filter — even if they haven't filed yet.
  useEffect(() => {
    apiGet<{ subscribers: SubscriberRef[] }>('/api/team')
      .then(d => setSubscribers(d.subscribers))
      .catch(() => {/* dropdown falls back to the derive-from-reports list */});
  }, []);
  useEffect(() => { load(); }, [days]);

  async function generateSummary() {
    setGenLoading(true);
    try {
      const r = await apiPost<{ summary: string }>('/api/agent/summary');
      setSummary(r.summary || '(empty)');
    } catch (e) { setSummary('Error: ' + String(e)); }
    finally { setGenLoading(false); }
  }

  const today = todayLocalISO();
  const todayReports = reports.filter(r => toISODate(r.report_date) === today);
  const todayFiled = todayReports.filter(r =>
    r.goals || r.mid_progress || r.eod_completed).length;
  // Dropdown = every active subscriber. If the /api/team fetch hasn't
  // landed yet, fall back to deriving from reports so the control is
  // never empty.
  const subs = useMemo(() => {
    if (subscribers.length > 0) {
      return subscribers.filter(s => s.active).map<[string, string]>(s => [s.id, s.name]);
    }
    const m = new Map<string, string>();
    reports.forEach(r => m.set(r.subscriber_id, r.subscriber_name));
    return Array.from(m.entries());
  }, [subscribers, reports]);
  const activeSubCount = subscribers.filter(s => s.active).length || todayReports.length;
  const totalIssues = todayReports.filter(r => r.mid_issues).length;
  const totalHours = todayReports.reduce((s, r) => s + (Number(r.eod_hours) || 0), 0);

  const filtered = subFilter === 'all'
    ? reports
    : reports.filter(r => r.subscriber_id === subFilter);

  const byDate = useMemo(() => {
    const m = new Map<string, Report[]>();
    filtered.forEach(r => {
      // Normalise to YYYY-MM-DD or '__nodate' so malformed/null rows still
      // render instead of collapsing under an "Invalid Date" heading.
      const key = toISODate(r.report_date) ?? '__nodate';
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    });
    return Array.from(m.entries()).sort((a, b) => {
      if (a[0] === '__nodate') return 1;
      if (b[0] === '__nodate') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [filtered]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Work Reports</h2>
          <p className="text-slate-500 font-medium">
            Team standup in 3 slots — 9:00 · 13:30 · 18:30 (SGT). Sent via Telegram, recorded here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={subFilter} onChange={e => setSubFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white font-medium">
            <option value="all">Everyone</option>
            {subs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white font-medium">
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <div className="flex bg-slate-200 p-0.5 rounded-xl">
            <button onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition ${viewMode==='list'?'bg-white text-indigo-600 shadow-sm':'text-slate-500'}`}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('calendar')}
              className={`p-2 rounded-lg transition ${viewMode==='calendar'?'bg-white text-indigo-600 shadow-sm':'text-slate-500'}`}>
              <CalendarIcon className="w-4 h-4" />
            </button>
          </div>
          {isBoss && (
            <button onClick={() => setShowManualLog(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium
                         bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-3 py-2">
              <PlusCircle className="w-4 h-4" /> Log report
            </button>
          )}
        </div>
      </div>

      {showManualLog && (
        <ManualLogModal
          subscribers={subscribers}
          onDone={() => { setShowManualLog(false); load(); }}
          onClose={() => setShowManualLog(false)} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
        <StatCard
          label="Filed today"
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          value={`${todayFiled}/${todayReports.length}`}
          sub="subscribers reported"
        />
        <StatCard
          label="Active subscribers"
          icon={<UserIcon className="w-4 h-4 text-indigo-500" />}
          value={activeSubCount}
          sub="receiving prompts"
        />
        <StatCard
          label="Hours logged"
          icon={<Clock className="w-4 h-4 text-sky-500" />}
          value={`${totalHours.toFixed(1)}h`}
          sub="today, end-of-day"
        />
        <StatCard
          label="Blockers flagged"
          icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
          value={totalIssues}
          sub="today, midday"
          tone={totalIssues > 0 ? 'rose' : 'default'}
        />
      </div>

      {(isBoss || me.role === 'pa') && <AskReportsPanel />}

      {/* Intelligence Briefing (AI) */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-[1px] rounded-[28px] shadow-xl">
        <div className="bg-white rounded-[27px] p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Intelligence Briefing</h3>
                <p className="text-sm text-slate-500">AI synthesis of today's team reports</p>
              </div>
            </div>
            <button onClick={generateSummary} disabled={genLoading}
              className="px-5 py-2 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50
                         text-indigo-700 font-semibold rounded-xl text-sm flex items-center gap-2">
              {genLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
              {summary ? 'Refresh' : 'Generate'}
            </button>
          </div>
          <div className="bg-slate-50/60 border border-slate-100 rounded-2xl p-6 min-h-[90px]">
            {summary ? (
              <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{summary}</p>
            ) : (
              <p className="text-slate-400 italic text-sm text-center py-3">
                Click <strong>Generate</strong> to have Claude read today's reports + flag blockers.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Log feed */}
      {byDate.length === 0 && !loading ? (
        <div className="py-16 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
          No reports in this window. Either subscribers are on leave, or the 3× Prompter
          hasn't fired yet today.
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-6">
          {byDate.map(([date, rows]) => (
            <section key={date}>
              <h3 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3 px-1">
                {date === '__nodate' ? 'No date recorded' : formatDateLabel(date)}
                {date === today && <span className="ml-2 text-indigo-600">· Today</span>}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.map(r => {
                  const ageHours = r.created_at
                    ? (Date.now() - new Date(r.created_at).getTime()) / 3_600_000
                    : Infinity;
                  const isOwner = !!r.subscriber_email
                    && r.subscriber_email.toLowerCase() === me.email?.toLowerCase();
                  const canEdit = isBoss || (isOwner && ageHours < 12);
                  return (
                    <ReportCard key={r.id} r={r}
                      isBoss={isBoss}
                      canEdit={canEdit}
                      ownerEditWindowOpen={isOwner && ageHours < 12 && !isBoss}
                      ageHours={ageHours}
                      importedCount={importedById.get(r.id) ?? 0}
                      onChanged={() => load()} />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <CalendarView byDate={byDate} />
      )}
    </div>
  );
}

const StatCard = ({ label, icon, value, sub, tone = 'default' }: {
  label: string; icon: React.ReactNode; value: React.ReactNode; sub?: string; tone?: 'default' | 'rose';
}) => (
  <div className={`p-5 border rounded-3xl shadow-sm ${
    tone === 'rose' ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-200'
  }`}>
    <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-2
      ${tone === 'rose' ? 'text-rose-500' : 'text-slate-400'}`}>
      {icon}<span>{label}</span>
    </div>
    <div className={`text-3xl font-bold ${tone === 'rose' ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
    {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
  </div>
);

const ReportCard = ({ r, isBoss, canEdit, ownerEditWindowOpen, ageHours, importedCount, onChanged }: {
  r: Report;
  isBoss: boolean;
  canEdit: boolean;
  ownerEditWindowOpen: boolean;
  ageHours: number;
  importedCount: number;
  onChanged: () => void;
}) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [draftDate, setDraftDate] = useState(toISODate(r.report_date) ?? '');
  const [dateBusy, setDateBusy] = useState(false);
  const [dateErr, setDateErr] = useState<string | null>(null);
  const progress =
    [r.goals, r.mid_progress, r.eod_completed].filter(Boolean).length / 3;
  const statusColor =
    progress === 1 ? 'bg-emerald-500' :
    progress >= 0.67 ? 'bg-sky-500' :
    progress >= 0.34 ? 'bg-amber-500' :
    progress === 0 ? 'bg-slate-300' : 'bg-slate-400';

  async function patchField(field: string, value: string | number | null) {
    const res = await apiFetch(`/api/reports/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    onChanged();
  }

  async function deleteRow() {
    setDelBusy(true);
    try {
      const res = await apiFetch(`/api/reports/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch { /* swallow — parent load() will refetch anyway */ }
    finally { setDelBusy(false); }
  }

  async function commitDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftDate)) {
      setDateErr('Pick a valid date'); return;
    }
    setDateBusy(true); setDateErr(null);
    try {
      const res = await apiFetch(`/api/reports/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ report_date: draftDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setEditingDate(false);
      onChanged();
    } catch (e) { setDateErr((e as Error).message); }
    finally { setDateBusy(false); }
  }

  return (
    <article className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm hover:shadow-md transition">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 className="font-bold text-slate-900">{r.subscriber_name}</h4>
          <p className="text-xs text-slate-500 font-medium">
            {r.subscriber_role || 'team'} · updated {new Date(r.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {r.eod_hours !== null && r.eod_hours !== undefined && (
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
              {r.eod_hours}h
            </span>
          )}
          <span className={`block w-2 h-2 rounded-full ${statusColor}`} title={`${Math.round(progress*100)}% filed`} />
          {isBoss && !editingDate && (
            <button onClick={() => { setDraftDate(toISODate(r.report_date) ?? ''); setEditingDate(true); }}
              title="Move this report to a different date"
              className="p-1 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded">
              <CalendarIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {isBoss && !confirmDel && (
            <button onClick={() => setConfirmDel(true)}
              title="Delete this report row"
              className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>
      {editingDate && (
        <div className="mb-3 -mt-2 flex items-center gap-2 text-xs text-indigo-800
                        bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1.5">
          <CalendarIcon className="w-3.5 h-3.5" />
          <span>Move to:</span>
          <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
            className="border border-indigo-200 rounded px-2 py-0.5 bg-white" />
          <button onClick={commitDate} disabled={dateBusy}
            className="ml-1 px-2 py-0.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700
                       disabled:opacity-40 text-white rounded">
            {dateBusy ? '…' : 'Move'}
          </button>
          <button onClick={() => { setEditingDate(false); setDateErr(null); }}
            className="px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 rounded">
            Cancel
          </button>
          {dateErr && <span className="text-rose-600">{dateErr}</span>}
        </div>
      )}
      {isBoss && confirmDel && (
        <div className="mb-3 -mt-2 flex items-center gap-2 text-xs text-rose-700
                        bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Delete this whole report row?
          <button onClick={deleteRow} disabled={delBusy}
            className="ml-auto px-2 py-0.5 text-xs font-medium bg-rose-600 hover:bg-rose-700
                       disabled:opacity-40 text-white rounded">
            {delBusy ? '…' : 'Yes, delete'}
          </button>
          <button onClick={() => setConfirmDel(false)}
            className="px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 rounded">
            Cancel
          </button>
        </div>
      )}

      {ownerEditWindowOpen && (
        <div className="mb-3 -mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700
                        bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 w-fit">
          <Clock className="w-3 h-3" />
          You can edit your own slots for {Math.max(0, 12 - Math.floor(ageHours))}h more
        </div>
      )}
      <SlotRow icon={<Sun className="w-4 h-4 text-amber-500"/>} label="Morning goals"
        value={r.goals} slot="morning"
        canEdit={canEdit} fieldName="goals"
        onSave={v => patchField('goals', v)} />
      {r.goals && r.goals.trim() && (
        <ImportGoalsButton reportId={r.id} goals={r.goals}
          importedCount={importedCount}
          onImported={onChanged} />
      )}
      <SlotRow icon={<Clock className="w-4 h-4 text-sky-500"/>} label="Midday progress"
        value={r.mid_progress}
        issues={r.mid_issues} changes={r.mid_changes} slot="midday"
        canEdit={canEdit} fieldName="mid_progress"
        onSave={v => patchField('mid_progress', v)} />
      <SlotRow icon={<Moon className="w-4 h-4 text-indigo-500"/>} label="End of day"
        value={r.eod_completed}
        unfinished={r.eod_unfinished} slot="eod" last
        canEdit={canEdit} fieldName="eod_completed"
        onSave={v => patchField('eod_completed', v)} />
    </article>
  );
};

// Compact row under Morning goals that turns those goals into Board cards.
// Already-imported reports show a disabled badge so the boss doesn't
// double-click and the backend's 409 guard stays a belt-and-braces check.
function ImportGoalsButton({ reportId, goals, importedCount, onImported }: {
  reportId: string;
  goals: string;
  importedCount: number;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parsed = previewGoalLines(goals);

  async function submit() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/kanban/cards/from-report/${reportId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onImported();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  if (importedCount > 0) {
    return (
      <div className="ml-6 mb-3 text-xs text-emerald-700 bg-emerald-50
                      border border-emerald-200 rounded-lg px-2.5 py-1 inline-flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {importedCount} goal {importedCount === 1 ? 'card' : 'cards'} on Board
      </div>
    );
  }
  return (
    <div className="ml-6 mb-3">
      <button onClick={submit} disabled={busy || parsed === 0}
        title={`Creates ${parsed} card${parsed === 1 ? '' : 's'} in the Today column, assigned to the author.`}
        className="inline-flex items-center gap-1.5 text-xs font-medium
                   text-indigo-700 bg-indigo-50 hover:bg-indigo-100
                   disabled:opacity-40 rounded-lg px-2.5 py-1">
        {busy
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Kanban className="w-3.5 h-3.5" />}
        Import {parsed} {parsed === 1 ? 'goal' : 'goals'}
        <ArrowRight className="w-3 h-3" />
      </button>
      {err && <div className="text-[11px] text-rose-600 mt-1">{err}</div>}
    </div>
  );
}

// Mirror of the server-side parser — line count only, so the button
// shows "Import 3 goals" before the user clicks.
function previewGoalLines(text: string): number {
  const lines = text
    .split(/\r?\n+/)
    .map(l => l.trim()
      .replace(/^[\d]+\s*[.):]\s+/, '')
      .replace(/^[-*•·‣]\s+/, '')
      .replace(/^\[\s*\]\s+/, '')
      .trim())
    .filter(l => l.length > 0);
  if (lines.length === 0 && text.trim()) return 1;
  return Math.min(lines.length, 20);
}

const SlotRow = ({ icon, label, value, issues, changes, unfinished, slot, last = false,
                   canEdit = false, fieldName, onSave }: {
  icon: React.ReactNode; label: string; value: string | null;
  issues?: string | null; changes?: string | null; unfinished?: string | null;
  slot: 'morning' | 'midday' | 'eod'; last?: boolean;
  canEdit?: boolean;
  fieldName?: 'goals' | 'mid_progress' | 'eod_completed';
  onSave?: (v: string | null) => Promise<void>;
}) => {
  const filled = !!value;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setDraft(value || ''); }, [value]);

  async function commit(next: string | null) {
    if (!onSave) return;
    setBusy(true); setErr(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className={`${last ? '' : 'pb-3 mb-3 border-b border-slate-100'}`}>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-1">
        {icon}<span className="uppercase tracking-wide">{label}</span>
        {!filled && !editing && <span className="ml-auto text-[10px] text-slate-300">pending</span>}
        {canEdit && fieldName && !editing && (
          <button onClick={() => { setDraft(value || ''); setEditing(true); }}
            title={filled ? 'Edit' : 'Add entry'}
            className={`${!filled ? '' : 'ml-auto'} p-0.5 text-slate-300 hover:text-indigo-600 rounded`}>
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            rows={3} autoFocus
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => commit(draft.trim() || null)} disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium
                         bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded">
              <Check className="w-3 h-3" /> Save
            </button>
            {filled && (
              <button onClick={() => commit(null)} disabled={busy}
                title="Clear this slot (set to null)"
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 rounded">
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            )}
            <button onClick={() => { setEditing(false); setDraft(value || ''); setErr(null); }}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 rounded">
              <X className="w-3 h-3" /> Cancel
            </button>
            {err && <span className="text-[11px] text-rose-600">{err}</span>}
          </div>
        </div>
      ) : filled ? (
        <p className="text-sm text-slate-700 whitespace-pre-line">{value}</p>
      ) : (
        <p className="text-xs text-slate-300 italic">No entry from {slot} slot yet.</p>
      )}
      {issues && (
        <p className="text-xs text-rose-700 mt-2 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1">
          ⚠️ {issues}
        </p>
      )}
      {changes && (
        <p className="text-xs text-indigo-700 mt-1 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1">
          ↻ {changes}
        </p>
      )}
      {unfinished && (
        <p className="text-xs text-amber-700 mt-1 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
          ⏸ {unfinished}
        </p>
      )}
    </div>
  );
};

const CalendarView = ({ byDate }: { byDate: [string, Report[]][] }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
    {byDate.map(([date, rows]) => {
      const filed = rows.filter(r => r.goals || r.mid_progress || r.eod_completed).length;
      const total = rows.length;
      const ratio = total > 0 ? filed / total : 0;
      return (
        <div key={date}
          className="aspect-square bg-white border border-slate-200 rounded-2xl p-3 flex flex-col">
          <div className="text-xs text-slate-500 font-medium">
            {new Date(date + 'T00:00:00').toLocaleDateString(undefined,
              { month: 'short', day: 'numeric' })}
          </div>
          <div className="text-lg font-bold text-slate-900 mt-auto">{filed}<span className="text-sm text-slate-400">/{total}</span></div>
          <div className="h-1 bg-slate-100 rounded-full mt-1">
            <div className={`h-full rounded-full ${
              ratio === 1 ? 'bg-emerald-500' : ratio >= 0.5 ? 'bg-sky-500' :
              ratio > 0 ? 'bg-amber-500' : 'bg-slate-200'
            }`} style={{ width: `${ratio * 100}%` }} />
          </div>
        </div>
      );
    })}
  </div>
);

// ---------- Ask AI panel --------------------------------------------- //
function AskReportsPanel() {
  const [question, setQuestion] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ rows: number; days: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const r = await apiPost<{ answer: string; rows: number; days: number }>(
        '/api/agent/ask-reports', { question: question.trim(), days }
      );
      setAnswer(r.answer);
      setMeta({ rows: r.rows, days: r.days });
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Ask the AI</h3>
          <p className="text-xs text-slate-500">
            Pose a question; Claude reads the last {days} days of reports and answers in plain prose.
          </p>
        </div>
      </div>
      <div className="flex items-stretch gap-2">
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white">
          <option value={3}>3d</option>
          <option value={7}>7d</option>
          <option value={14}>14d</option>
          <option value={30}>30d</option>
          <option value={60}>60d</option>
        </select>
        <input value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') ask(); }}
          placeholder="e.g. Who logged the most hours this week? · Has Andrea flagged blockers? · What's still unfinished?"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={ask} disabled={busy || !question.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                     bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ask
        </button>
      </div>
      {err && (
        <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
          {err}
        </div>
      )}
      {answer && (
        <div className="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-4">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{answer}</p>
          {meta && (
            <div className="mt-2 text-[11px] text-slate-400">
              based on {meta.rows} report row{meta.rows === 1 ? '' : 's'} from the last {meta.days} day{meta.days === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Manual log modal ----------------------------------------- //
function ManualLogModal({ subscribers, onDone, onClose }: {
  subscribers: SubscriberRef[];
  onDone: () => void;
  onClose: () => void;
}) {
  const active = subscribers.filter(s => s.active);
  const [subscriberId, setSubscriberId] = useState(active[0]?.id ?? '');
  const [reportDate, setReportDate] = useState(todayLocalISO());
  const [goals, setGoals] = useState('');
  const [midProgress, setMidProgress] = useState('');
  const [eodCompleted, setEodCompleted] = useState('');
  const [eodUnfinished, setEodUnfinished] = useState('');
  const [eodHours, setEodHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!subscriberId) { setErr('Pick a subscriber'); return; }
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = {
      subscriber_id: subscriberId,
      report_date: reportDate,
    };
    if (goals.trim())          body.goals = goals.trim();
    if (midProgress.trim())    body.mid_progress = midProgress.trim();
    if (eodCompleted.trim())   body.eod_completed = eodCompleted.trim();
    if (eodUnfinished.trim())  body.eod_unfinished = eodUnfinished.trim();
    if (eodHours.trim())       body.eod_hours = Number(eodHours);
    if (Object.keys(body).length <= 2) {
      setErr('Fill at least one slot field'); setBusy(false); return;
    }
    try {
      const res = await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={save}
        className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Log report manually</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Use this if Telegram capture missed something. Fields you leave blank stay untouched.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-6 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Subscriber</span>
              <select value={subscriberId} onChange={e => setSubscriberId(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Report date</span>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </label>
          </div>
          <ManualField label="Morning goals" value={goals} onChange={setGoals} />
          <ManualField label="Midday progress" value={midProgress} onChange={setMidProgress} />
          <ManualField label="EOD completed" value={eodCompleted} onChange={setEodCompleted} />
          <ManualField label="EOD unfinished" value={eodUnfinished} onChange={setEodUnfinished} />
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Hours worked</span>
            <input type="number" step="0.5" value={eodHours} onChange={e => setEodHours(e.target.value)}
              placeholder="(optional)"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              {err}
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {busy ? 'Saving…' : 'Save report'}
          </button>
        </footer>
      </form>
    </div>
  );
}

const ManualField = ({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-700">{label}</span>
    <textarea value={value} onChange={e => onChange(e.target.value)}
      rows={2} placeholder="(optional)"
      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
  </label>
);
