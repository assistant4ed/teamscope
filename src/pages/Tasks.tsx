import React, { useEffect, useState } from 'react';
import { apiGet, apiFetch, apiPost, Me } from '../auth';
import {
  CheckCircle2, PlayCircle, XCircle, RefreshCw, Kanban, X,
  EyeOff, Eye, Sparkles, AlertTriangle,
} from 'lucide-react';

interface Task {
  correlation_id: string;
  kind: string;
  status: string;
  asked_of: string | null;
  created_at: string;
  resolved_at: string | null;
  payload: Record<string, unknown> | null;
  origin_text: string | null;
  requester_name: string | null;
  requester_role: string | null;
}

interface Column { id: string; name: string; is_done: boolean }
interface Subscriber { id: string; name: string; active: boolean }

export default function Tasks({ me }: { me: Me }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<'approval' | 'all' | 'mine'>(
    me.role === 'pa' ? 'mine' : 'approval'
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [promote, setPromote] = useState<Task | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [tidyBusy, setTidyBusy] = useState(false);
  const [tidyResult, setTidyResult] = useState<{
    empty_cancelled: number; chatter_cancelled: number; kept: number;
    self_plans: Array<{ correlation_id: string; summary: string }>;
  } | null>(null);
  const selfPlanIds = new Set(tidyResult?.self_plans.map(s => s.correlation_id) ?? []);

  async function load() {
    setLoading(true);
    try {
      // Map UI scope → API params. 'approval' = real boss-approval tasks
      // only (no clarification chatter); 'all' = every kind; 'mine' = PA's
      // own bucket.
      const params = scope === 'approval' ? 'kind=approval&scope=all'
        : scope === 'mine' ? 'scope=mine&kind=all'
        : 'scope=all&kind=all';
      const d = await apiGet<{ tasks: Task[] }>(`/api/tasks?${params}`);
      setTasks(d.tasks);
      setErr(null);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }

  // Lightweight load of the Kanban targets so we can populate the
  // promote-to-card modal without opening the Board first.
  async function loadKanbanTargets() {
    try {
      const d = await apiGet<{ columns: Column[]; subscribers: Subscriber[] }>('/api/kanban/board');
      setColumns(d.columns);
      setSubs(d.subscribers);
    } catch { /* non-fatal — promote button will still work once columns exist */ }
  }

  useEffect(() => { load(); }, [scope]);
  useEffect(() => { loadKanbanTargets(); }, []);

  async function act(id: string, verb: 'claim' | 'complete' | 'cancel') {
    setBusy(id + ':' + verb);
    try {
      await apiPost(`/api/tasks/${id}/${verb}`, verb === 'complete' ? { notes: null } : undefined);
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }

  async function runTidy() {
    setTidyBusy(true); setErr(null);
    try {
      const r = await apiPost<{
        empty_cancelled: number; chatter_cancelled: number; kept: number;
        self_plans: Array<{ correlation_id: string; summary: string }>;
      }>('/api/tasks/cleanup', {});
      setTidyResult(r);
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setTidyBusy(false); }
  }

  const visibleTasks = hideEmpty
    ? tasks.filter(t => t.origin_text && t.origin_text.trim().length > 0)
    : tasks;
  const hiddenCount = tasks.length - visibleTasks.length;

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500">
            {me.role === 'pa' ? 'Your assignments from Ed.' : 'All pending & in-progress work.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setHideEmpty(v => !v)}
            title="Hide rows with no message body — usually media/forwards"
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border
              ${hideEmpty
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {hideEmpty ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {hideEmpty ? 'Hiding empty' : 'Show all'}
          </button>
          {me.role === 'boss' && (
            <button onClick={runTidy} disabled={tidyBusy}
              title="Use AI to cancel empty/chatter rows and flag self-plans for review"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg
                         bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 border border-indigo-200">
              <Sparkles className={`w-3.5 h-3.5 ${tidyBusy ? 'animate-pulse' : ''}`} />
              {tidyBusy ? 'Tidying…' : 'Run AI tidy'}
            </button>
          )}
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
            <button onClick={() => setScope('approval')}
              title="Only real boss-approval tasks; hides chatter clarifications"
              className={`px-3 py-1 text-sm rounded ${scope==='approval'?'bg-slate-900 text-white':'text-slate-600'}`}>
              Approvals
            </button>
            <button onClick={() => setScope('all')}
              title="All kinds, including clarification chatter"
              className={`px-3 py-1 text-sm rounded ${scope==='all'?'bg-slate-900 text-white':'text-slate-600'}`}>
              All
            </button>
            <button onClick={() => setScope('mine')}
              className={`px-3 py-1 text-sm rounded ${scope==='mine'?'bg-slate-900 text-white':'text-slate-600'}`}>
              Mine (PA)
            </button>
          </div>
          <button onClick={load}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
        </div>
      </div>

      {err && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{err}</div>}

      {tidyResult && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2 text-sm">
          <Sparkles className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-emerald-800">
            <b>AI tidy</b> — cancelled {tidyResult.empty_cancelled} empty
            + {tidyResult.chatter_cancelled} chatter rows.
            {tidyResult.self_plans.length > 0
              ? <> Flagged {tidyResult.self_plans.length} as <i>your own plan</i> — review the amber rows below.</>
              : <> {tidyResult.kept} task{tidyResult.kept === 1 ? '' : 's'} kept.</>}
          </div>
          <button onClick={() => setTidyResult(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {hideEmpty && hiddenCount > 0 && (
        <div className="mb-4 text-xs text-slate-500">
          {hiddenCount} empty row{hiddenCount === 1 ? '' : 's'} hidden ·{' '}
          <button onClick={() => setHideEmpty(false)} className="text-indigo-600 hover:text-indigo-800 underline">
            show
          </button>
        </div>
      )}

      {visibleTasks.length === 0 && !loading && (
        <div className="py-16 text-center text-slate-400">
          Nothing to do. {scope === 'mine' ? 'No tasks assigned to you.' : 'Inbox is empty.'}
        </div>
      )}

      <ul className="space-y-3">
        {visibleTasks.map(t => (
          <TaskCard key={t.correlation_id}
            t={t} me={me} busy={busy} act={act}
            onPromote={() => setPromote(t)}
            isSelfPlan={selfPlanIds.has(t.correlation_id)}
          />
        ))}
      </ul>

      {promote && (
        <PromoteModal task={promote}
          columns={columns} subscribers={subs}
          onDone={() => { setPromote(null); load(); }}
          onClose={() => setPromote(null)} />
      )}
    </div>
  );
}

function TaskCard({ t, me, busy, act, onPromote, isSelfPlan = false }: {
  t: Task; me: Me;
  busy: string | null;
  act: (id: string, verb: 'claim' | 'complete' | 'cancel') => void;
  onPromote: () => void;
  isSelfPlan?: boolean;
}) {
  const canAct = me.role === 'pa' || me.role === 'boss';

  return (
    <li className={`bg-white rounded-xl p-5 border ${
      isSelfPlan ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
    }`}>
      {isSelfPlan && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1 w-fit">
          <AlertTriangle className="w-3.5 h-3.5" />
          Looks like your own plan — Promote to card to track on the Board, or Cancel.
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <code>{t.correlation_id}</code>
            <span>·</span>
            <span>{t.kind}</span>
            <span>·</span>
            <span>{new Date(t.created_at).toLocaleString()}</span>
          </div>
          <p className="text-slate-800 font-medium">
            {t.origin_text || <em className="text-slate-400">(no message body)</em>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Tag color={
              t.status === 'pending' ? 'amber' :
              t.status === 'pa_review' ? 'indigo' :
              t.status === 'in_progress' ? 'blue' :
              'slate'
            }>{t.status}</Tag>
            {t.asked_of && <Tag color="slate">→ {t.asked_of}</Tag>}
            {t.requester_name && <Tag color="slate">from {t.requester_name}</Tag>}
          </div>
        </div>
      </div>

      {canAct && t.status !== 'completed' && t.status !== 'cancelled' && (
        <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
          <ActionBtn onClick={onPromote}
            busy={false}
            icon={<Kanban className="w-4 h-4" />} label="Promote to card"
            color="indigo" />
          {t.status !== 'in_progress' && (
            <ActionBtn onClick={() => act(t.correlation_id, 'claim')}
              busy={busy === t.correlation_id + ':claim'}
              icon={<PlayCircle className="w-4 h-4" />} label="Claim / Start"
              color="slate" />
          )}
          <ActionBtn onClick={() => act(t.correlation_id, 'complete')}
            busy={busy === t.correlation_id + ':complete'}
            icon={<CheckCircle2 className="w-4 h-4" />} label="Mark Done"
            color="emerald" />
          {me.role === 'boss' && (
            <ActionBtn onClick={() => act(t.correlation_id, 'cancel')}
              busy={busy === t.correlation_id + ':cancel'}
              icon={<XCircle className="w-4 h-4" />} label="Cancel"
              color="slate" />
          )}
        </div>
      )}
    </li>
  );
}

function PromoteModal({ task, columns, subscribers, onDone, onClose }: {
  task: Task;
  columns: Column[];
  subscribers: Subscriber[];
  onDone: () => void;
  onClose: () => void;
}) {
  // Default to the first non-done column (usually "Backlog" or "Today").
  const defaultCol = columns.find(c => !c.is_done)?.id || columns[0]?.id || '';
  const [columnId, setColumnId] = useState(defaultCol);
  const [title, setTitle] = useState(
    (task.origin_text || task.kind || '').slice(0, 200)
  );
  const [assignees, setAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleAssignee(id: string) {
    if (assignees.includes(id)) setAssignees(assignees.filter(x => x !== id));
    else if (assignees.length < 5) setAssignees([...assignees, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(
        `/api/kanban/cards/from-action/${encodeURIComponent(task.correlation_id)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            column_id: columnId,
            title: title.trim() || undefined,
            assignee_ids: assignees,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const canSubmit = !!columnId && !!title.trim() && !busy;
  const noColumns = columns.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Promote to Board card</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Marks the queue task done and creates a trackable card on the Board.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-6 space-y-4 overflow-y-auto">
          {noColumns && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              No Kanban columns exist yet. Open the Board tab once to initialise them.
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Card title</span>
            <textarea value={title} onChange={e => setTitle(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Column</span>
            <select value={columnId} onChange={e => setColumnId(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
              {columns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1">
              Assignees ({assignees.length}/5)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {subscribers.filter(s => s.active).map(s => {
                const on = assignees.includes(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => toggleAssignee(s.id)}
                    disabled={!on && assignees.length >= 5}
                    className={`px-2 py-1 rounded-lg text-xs border transition
                      disabled:opacity-30 disabled:cursor-not-allowed
                      ${on
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {s.name}
                  </button>
                );
              })}
              {subscribers.filter(s => s.active).length === 0 && (
                <p className="text-xs text-slate-400">
                  No active subscribers — add teammates on the Team page.
                </p>
              )}
            </div>
          </div>
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
          <button type="submit" disabled={!canSubmit || noColumns}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {busy ? 'Promoting…' : 'Create card'}
          </button>
        </footer>
      </form>
    </div>
  );
}

// CDN Tailwind JIT can't see dynamic class names like `bg-${color}-50`,
// so we map to static class strings here. Adding a new tone? Add it
// to both maps; never compose Tailwind class names from runtime values.
const TAG_CLS: Record<string, string> = {
  amber:   'bg-amber-50 text-amber-700',
  indigo:  'bg-indigo-50 text-indigo-700',
  blue:    'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose:    'bg-rose-50 text-rose-700',
  slate:   'bg-slate-100 text-slate-700',
};
const ACTION_CLS: Record<string, string> = {
  indigo:  'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  amber:   'bg-amber-50 text-amber-700 hover:bg-amber-100',
  rose:    'bg-rose-50 text-rose-700 hover:bg-rose-100',
  slate:   'bg-slate-100 text-slate-700 hover:bg-slate-200',
};

const Tag = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span className={`px-2 py-0.5 rounded-full ${TAG_CLS[color] ?? TAG_CLS.slate}`}>
    {children}
  </span>
);

const ActionBtn = ({ onClick, busy, icon, label, color }: {
  onClick: () => void; busy: boolean;
  icon: React.ReactNode; label: string; color: string;
}) => (
  <button onClick={onClick} disabled={busy}
    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
      disabled:opacity-50 transition ${ACTION_CLS[color] ?? ACTION_CLS.slate}`}>
    {icon}{busy ? '…' : label}
  </button>
);
