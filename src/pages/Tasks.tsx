import React, { useEffect, useState } from 'react';
import { apiGet, apiPost, Me } from '../auth';
import { CheckCircle2, PlayCircle, XCircle, RefreshCw } from 'lucide-react';

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

export default function Tasks({ me }: { me: Me }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'mine'>(me.role === 'pa' ? 'mine' : 'all');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<{ tasks: Task[] }>(`/api/tasks?scope=${scope}`);
      setTasks(d.tasks);
      setErr(null);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [scope]);

  async function act(id: string, verb: 'claim' | 'complete' | 'cancel') {
    setBusy(id + ':' + verb);
    try {
      await apiPost(`/api/tasks/${id}/${verb}`, verb === 'complete' ? { notes: null } : undefined);
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500">
            {me.role === 'pa' ? 'Your assignments from Ed.' : 'All pending & in-progress work.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
            <button onClick={() => setScope('all')}
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

      {tasks.length === 0 && !loading && (
        <div className="py-16 text-center text-slate-400">
          Nothing to do. {scope === 'mine' ? 'No tasks assigned to you.' : 'Inbox is empty.'}
        </div>
      )}

      <ul className="space-y-3">
        {tasks.map(t => <TaskCard key={t.correlation_id} t={t} me={me} busy={busy} act={act} />)}
      </ul>
    </div>
  );
}

function TaskCard({ t, me, busy, act }: {
  t: Task; me: Me;
  busy: string | null;
  act: (id: string, verb: 'claim' | 'complete' | 'cancel') => void;
}) {
  const canAct = me.role === 'pa' || me.role === 'boss';

  return (
    <li className="bg-white border border-slate-200 rounded-xl p-5">
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
          {t.status !== 'in_progress' && (
            <ActionBtn onClick={() => act(t.correlation_id, 'claim')}
              busy={busy === t.correlation_id + ':claim'}
              icon={<PlayCircle className="w-4 h-4" />} label="Claim / Start"
              color="indigo" />
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

const Tag = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span className={`px-2 py-0.5 rounded-full bg-${color}-50 text-${color}-700`}>
    {children}
  </span>
);

const ActionBtn = ({ onClick, busy, icon, label, color }: {
  onClick: () => void; busy: boolean;
  icon: React.ReactNode; label: string; color: string;
}) => (
  <button onClick={onClick} disabled={busy}
    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
      bg-${color}-50 text-${color}-700 hover:bg-${color}-100 disabled:opacity-50 transition`}>
    {icon}{busy ? '…' : label}
  </button>
);
