import React, { useEffect, useMemo, useState } from 'react';
import {
  Sun, Moon, Clock, Sparkles, Activity, List, Calendar as CalendarIcon,
  Loader2, AlertTriangle, CheckCircle2, User as UserIcon,
} from 'lucide-react';
import { apiGet, apiPost } from '../auth';

interface Report {
  id: string;
  subscriber_id: string;
  subscriber_name: string;
  subscriber_role: string | null;
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

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [days, setDays] = useState(14);
  const [subFilter, setSubFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [summary, setSummary] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<{ reports: Report[] }>(`/api/reports/recent?days=${days}`);
      setReports(d.reports);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [days]);

  async function generateSummary() {
    setGenLoading(true);
    try {
      const r = await apiPost<{ summary: string }>('/api/agent/summary');
      setSummary(r.summary || '(empty)');
    } catch (e) { setSummary('Error: ' + String(e)); }
    finally { setGenLoading(false); }
  }

  const today = todayISO();
  const todayReports = reports.filter(r => r.report_date === today);
  const todayFiled = todayReports.filter(r =>
    r.goals || r.mid_progress || r.eod_completed).length;
  const subs = useMemo(() => {
    const m = new Map<string, string>();
    reports.forEach(r => m.set(r.subscriber_id, r.subscriber_name));
    return Array.from(m.entries());
  }, [reports]);
  const totalIssues = todayReports.filter(r => r.mid_issues).length;
  const totalHours = todayReports.reduce((s, r) => s + (Number(r.eod_hours) || 0), 0);

  const filtered = subFilter === 'all'
    ? reports
    : reports.filter(r => r.subscriber_id === subFilter);

  const byDate = useMemo(() => {
    const m = new Map<string, Report[]>();
    filtered.forEach(r => {
      const arr = m.get(r.report_date) ?? [];
      arr.push(r);
      m.set(r.report_date, arr);
    });
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
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
        </div>
      </div>

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
          value={todayReports.length}
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
                {new Date(date + 'T00:00:00').toLocaleDateString(undefined,
                  { weekday: 'long', month: 'short', day: 'numeric' })}
                {date === today && <span className="ml-2 text-indigo-600">· Today</span>}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.map(r => <ReportCard key={r.id} r={r} />)}
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

const ReportCard = ({ r }: { r: Report }) => {
  const progress =
    [r.goals, r.mid_progress, r.eod_completed].filter(Boolean).length / 3;
  const statusColor =
    progress === 1 ? 'bg-emerald-500' :
    progress >= 0.67 ? 'bg-sky-500' :
    progress >= 0.34 ? 'bg-amber-500' :
    progress === 0 ? 'bg-slate-300' : 'bg-slate-400';

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
        </div>
      </header>

      <SlotRow icon={<Sun className="w-4 h-4 text-amber-500"/>} label="Morning goals"
        value={r.goals} slot="morning" />
      <SlotRow icon={<Clock className="w-4 h-4 text-sky-500"/>} label="Midday progress"
        value={r.mid_progress}
        issues={r.mid_issues} changes={r.mid_changes} slot="midday" />
      <SlotRow icon={<Moon className="w-4 h-4 text-indigo-500"/>} label="End of day"
        value={r.eod_completed}
        unfinished={r.eod_unfinished} slot="eod" last />
    </article>
  );
};

const SlotRow = ({ icon, label, value, issues, changes, unfinished, slot, last = false }: {
  icon: React.ReactNode; label: string; value: string | null;
  issues?: string | null; changes?: string | null; unfinished?: string | null;
  slot: 'morning' | 'midday' | 'eod'; last?: boolean;
}) => {
  const filled = !!value;
  return (
    <div className={`${last ? '' : 'pb-3 mb-3 border-b border-slate-100'}`}>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-1">
        {icon}<span className="uppercase tracking-wide">{label}</span>
        {!filled && <span className="ml-auto text-[10px] text-slate-300">pending</span>}
      </div>
      {filled ? (
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
