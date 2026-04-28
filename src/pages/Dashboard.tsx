import React, { useEffect, useState } from 'react';
import { apiFetch, apiGet, Me } from '../auth';
import {
  CheckCircle2, AlertCircle, Clock, Users, ListChecks,
  AlertTriangle, Send, Loader2, Handshake, Activity,
} from 'lucide-react';

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

interface MissedSubscriber {
  subscriber_id: string; name: string;
  is_off: boolean; missing_slots: string[]; fully_reported: boolean;
}
interface PromiseRow {
  subscriber_id: string; name: string; total: number; kept: number;
}
interface PulseSlotStatus {
  status: 'sent' | 'pending' | 'late' | 'missed';
  expected_local_time: string;
}
interface PulseRow {
  subscriber_id: string;
  name: string;
  slots: Record<'morning' | 'midday' | 'eod', PulseSlotStatus | undefined>;
}

export default function Dashboard({ me }: { me: Me }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missed, setMissed] = useState<MissedSubscriber[] | null>(null);
  const [missedDate, setMissedDate] = useState<string>('');
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestResult, setDigestResult] = useState<string | null>(null);
  const [promises, setPromises] = useState<PromiseRow[]>([]);
  const [pulse, setPulse] = useState<PulseRow[]>([]);

  useEffect(() => {
    apiGet<Data>('/api/dashboard')
      .then(setData)
      .catch(e => setErr(String(e)));
    apiGet<{ date: string; subscribers: MissedSubscriber[] }>('/api/missed-slots')
      .then(d => { setMissed(d.subscribers); setMissedDate(d.date); })
      .catch(() => {/* silent */});
    apiGet<{ date: string; members: PromiseRow[] }>('/api/dashboard/promises')
      .then(d => setPromises(d.members || []))
      .catch(() => {/* silent — feature is opt-in via a morning report */});
    apiGet<{ members: PulseRow[] }>('/api/dashboard/bot-pulse')
      .then(d => setPulse(d.members || []))
      .catch(() => {/* silent */});
  }, []);

  async function dmDigest() {
    setDigestBusy(true); setDigestResult(null);
    try {
      const res = await apiFetch('/api/missed-slots/digest', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      setDigestResult(`Sent · ${(body as {missing_count:number}).missing_count} flagged`);
      setTimeout(() => setDigestResult(null), 4000);
    } catch (e) { setDigestResult(`Failed: ${(e as Error).message}`); }
    finally { setDigestBusy(false); }
  }

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

      {pulse.length > 0 && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-5 h-5 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Bot pulse — today
            </h2>
            {pulse.some(p => Object.values(p.slots).some(s => s?.status === 'missed')) && (
              <span className="ml-auto text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                misses detected
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {pulse.map(p => (
              <div key={p.subscriber_id} className="flex items-center gap-3 text-sm">
                <span className="w-32 text-slate-700 font-medium truncate">{p.name}</span>
                {(['morning','midday','eod'] as const).map(slot => {
                  const s = p.slots[slot];
                  if (!s) return null;
                  const dotCls = {
                    sent:    'bg-emerald-500',
                    pending: 'bg-slate-300',
                    late:    'bg-amber-400 animate-pulse',
                    missed:  'bg-rose-500',
                  }[s.status];
                  return (
                    <div key={slot} className="inline-flex items-center gap-1.5"
                         title={`${slot} (${s.expected_local_time}) — ${s.status}`}>
                      <span className={`w-2 h-2 rounded-full ${dotCls}`} />
                      <span className="text-[11px] text-slate-500 tabular-nums">{s.expected_local_time}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
            <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />sent</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-slate-300 mr-1" />pending</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />late (within 30m)</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1" />missed (&gt;30m)</span>
          </div>
        </div>
      )}

      {promises.length > 0 && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Handshake className="w-5 h-5 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Today's promises
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {promises.map(p => {
              const pct = p.total === 0 ? 0 : Math.round((p.kept / p.total) * 100);
              const color = pct === 100
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : pct >= 50
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-600';
              return (
                <span key={p.subscriber_id}
                  className={`inline-flex items-center gap-1.5 text-sm border rounded-full px-3 py-1 ${color}`}>
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums">{p.kept}/{p.total}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {missed && missed.some(m => !m.is_off && !m.fully_reported) && (
        <div className="mb-8 bg-white border border-amber-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                Yesterday's misses ({missedDate})
              </h2>
            </div>
            {me.role === 'boss' && (
              <button onClick={dmDigest} disabled={digestBusy}
                className="inline-flex items-center gap-1.5 text-xs font-medium
                           bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-3 py-1.5
                           disabled:opacity-40">
                {digestBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {digestResult || 'DM me the digest'}
              </button>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            {missed.filter(m => !m.is_off && !m.fully_reported).map(m => (
              <li key={m.subscriber_id} className="flex items-center justify-between py-1">
                <span className="text-slate-800">{m.name}</span>
                <span className="text-xs text-amber-700">
                  missed: {m.missing_slots.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
