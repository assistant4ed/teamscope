import React, { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../auth';

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

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [days, setDays] = useState(14);
  const [subFilter, setSubFilter] = useState<string>('all');

  useEffect(() => {
    apiGet<{ reports: Report[] }>(`/api/reports/recent?days=${days}`)
      .then(d => setReports(d.reports))
      .catch(() => setReports([]));
  }, [days]);

  const subscribers = useMemo(() => {
    const m = new Map<string, string>();
    reports.forEach(r => m.set(r.subscriber_id, r.subscriber_name));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [reports]);

  const filtered = subFilter === 'all'
    ? reports
    : reports.filter(r => r.subscriber_id === subFilter);

  // Group by date
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
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Work Reports</h1>
          <p className="text-sm text-slate-500">Three-slot daily check-ins from the team.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={subFilter} onChange={e => setSubFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <option value="all">Everyone</option>
            {subscribers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>

      {byDate.length === 0 && (
        <div className="py-16 text-center text-slate-400">
          No reports in the selected window.
        </div>
      )}

      <div className="space-y-6">
        {byDate.map(([date, rows]) => (
          <div key={date}>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
              {new Date(date + 'T00:00:00').toLocaleDateString(undefined,
                { weekday: 'long', month: 'short', day: 'numeric' })}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map(r => <ReportCard key={r.id} r={r} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportCard({ r }: { r: Report }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium text-slate-800">
          {r.subscriber_name}
          {r.subscriber_role && <span className="ml-2 text-xs text-slate-400">{r.subscriber_role}</span>}
        </div>
        {r.eod_hours !== null && (
          <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            {r.eod_hours}h
          </span>
        )}
      </div>
      <Slot icon="☀" title="Goals" text={r.goals} />
      <Slot icon="⏱" title="Mid-day" text={r.mid_progress}
        issues={r.mid_issues} changes={r.mid_changes} />
      <Slot icon="🌙" title="End of day"
        text={r.eod_completed} unfinished={r.eod_unfinished} />
      {!r.goals && !r.mid_progress && !r.eod_completed && (
        <div className="text-xs text-slate-400 italic">Nothing filed yet.</div>
      )}
    </div>
  );
}

function Slot({
  icon, title, text, issues, changes, unfinished,
}: {
  icon: string; title: string; text: string | null;
  issues?: string | null; changes?: string | null; unfinished?: string | null;
}) {
  if (!text && !issues && !changes && !unfinished) return null;
  return (
    <div className="mt-2 text-sm">
      <div className="text-xs text-slate-400 mb-0.5">{icon} {title}</div>
      {text && <div className="text-slate-700 whitespace-pre-line">{text}</div>}
      {issues && <div className="text-rose-700 text-xs mt-1">⚠ {issues}</div>}
      {changes && <div className="text-indigo-700 text-xs mt-1">↻ {changes}</div>}
      {unfinished && <div className="text-amber-700 text-xs mt-1">⏸ {unfinished}</div>}
    </div>
  );
}
