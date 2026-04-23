import React, { useEffect, useState } from 'react';
import { apiGet } from '../auth';
import { CheckCircle2, AlertCircle, Clock, Users, ListChecks } from 'lucide-react';

interface TodayReport {
  name: string;
  role: string | null;
  report_date: string | null;
  goals: string | null;
  mid_progress: string | null;
  eod_completed: string | null;
  eod_hours: number | null;
  updated_at: string | null;
}
interface PendingTask {
  correlation_id: string;
  kind: string;
  status: string;
  asked_of: string | null;
  created_at: string;
}
interface Action {
  id: string; domain: string; action: string; executor: string;
  outcome: string; created_at: string;
}
interface Sub { id: string; name: string; role: string | null; active: boolean }

interface Data {
  today: TodayReport[];
  pending: PendingTask[];
  recentActions: Action[];
  subs: Sub[];
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Data>('/api/dashboard')
      .then(setData)
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="p-8 text-red-600">{err}</div>;
  if (!data) return <div className="p-8 text-slate-400">Loading…</div>;

  const filedToday = data.today.filter(r => r.goals || r.mid_progress || r.eod_completed).length;
  const totalSubs = data.today.length;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Dashboard</h1>
      <p className="text-sm text-slate-500 mb-6">Today, {new Date().toLocaleDateString()}</p>

      {/* Top cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card icon={<Users className="w-5 h-5" />} label="Active members" value={data.subs.length} />
        <Card icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />} label="Reports today" value={`${filedToday}/${totalSubs}`} />
        <Card icon={<ListChecks className="w-5 h-5 text-indigo-600" />} label="Open tasks" value={data.pending.length} />
        <Card icon={<Clock className="w-5 h-5 text-amber-600" />} label="Recent actions" value={data.recentActions.length} />
      </div>

      {/* Two columns: today's reports + pending tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Today's reports">
          {data.today.length === 0 && <Empty>No subscribers yet.</Empty>}
          <ul className="divide-y divide-slate-100">
            {data.today.map(r => (
              <li key={r.name} className="py-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800">{r.name}
                    {r.role && <span className="ml-2 text-xs text-slate-400">{r.role}</span>}
                  </div>
                  <StatusPill
                    filled={!!(r.goals || r.mid_progress || r.eod_completed)}
                  />
                </div>
                {r.goals && <Line label="☀" text={r.goals} />}
                {r.mid_progress && <Line label="⏱" text={r.mid_progress} />}
                {r.eod_completed && <Line label="🌙" text={r.eod_completed} />}
                {!r.goals && !r.mid_progress && !r.eod_completed &&
                  <div className="text-xs text-slate-400 mt-1">No entries yet.</div>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Open tasks">
          {data.pending.length === 0 && <Empty>No pending tasks. Clean slate.</Empty>}
          <ul className="divide-y divide-slate-100">
            {data.pending.slice(0, 10).map(t => (
              <li key={t.correlation_id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    <code className="text-xs text-slate-400">{t.correlation_id}</code>
                    {' · '}{t.kind}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {t.asked_of ? `→ ${t.asked_of}` : 'waiting'}
                    {' · '}{new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  t.status === 'pa_review' ? 'bg-indigo-50 text-indigo-700' :
                  t.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                  'bg-slate-50 text-slate-700'
                }`}>{t.status}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

const Card = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-4">
    <div className="flex items-center gap-2 text-slate-500 text-sm">{icon}{label}</div>
    <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
  </div>
);

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5">
    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{title}</h2>
    {children}
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="py-8 text-center text-sm text-slate-400">{children}</div>
);

const Line = ({ label, text }: { label: string; text: string }) => (
  <div className="text-xs text-slate-600 mt-1 pl-1 truncate">
    <span className="mr-1">{label}</span>{text}
  </div>
);

const StatusPill = ({ filled }: { filled: boolean }) =>
  filled ? (
    <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3" /> filed
    </span>
  ) : (
    <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full flex items-center gap-1">
      <AlertCircle className="w-3 h-3" /> pending
    </span>
  );
