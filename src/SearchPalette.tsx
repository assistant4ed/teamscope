import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Kanban, ClipboardList, User } from 'lucide-react';
import { apiFetch } from './auth';

interface SearchCard {
  id: string; title: string; description: string | null;
  column_id: string; column_name: string; board_id: string;
  board_name: string; image_urls: string[];
}
interface SearchReport {
  id: string; report_date: string; subscriber_id: string;
  subscriber_name: string;
  goals: string | null; mid_progress: string | null; eod_completed: string | null;
}
interface SearchMember {
  id: string; name: string; role: string | null; active: boolean;
}
interface SearchResults {
  q: string; cards: SearchCard[]; reports: SearchReport[]; members: SearchMember[];
}

// Linear / Notion-style command palette. Triggered by ⌘K (or Ctrl+K)
// from anywhere in Shell. Searches cards / reports / members in one
// call; arrow keys navigate, Enter opens, Esc closes. Selecting a
// result invokes the parent's onPick — Shell decides what to do
// (switch tab + scroll into view) since nav state lives there.
export type SearchHit =
  | { type: 'card'; card: SearchCard }
  | { type: 'report'; report: SearchReport }
  | { type: 'member'; member: SearchMember };

export default function SearchPalette({ onPick, onClose }: {
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced fetch.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (r.ok) {
          const data: SearchResults = await r.json();
          setResults(data);
          setActive(0);
        }
      } finally { setBusy(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const flat: SearchHit[] = useMemo(() => {
    if (!results) return [];
    return [
      ...results.cards.map<SearchHit>(c => ({ type: 'card', card: c })),
      ...results.members.map<SearchHit>(m => ({ type: 'member', member: m })),
      ...results.reports.map<SearchHit>(r => ({ type: 'report', report: r })),
    ];
  }, [results]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[active];
      if (hit) onPick(hit);
    }
  }, [flat, active, onPick, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 grid place-items-start justify-items-center pt-[12vh] p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
           onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search cards, reports, members…"
            className="flex-1 outline-none text-sm bg-transparent" />
          <kbd className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="overflow-y-auto flex-1">
          {q.trim().length < 2 && (
            <p className="p-6 text-center text-xs text-slate-400">
              Type at least 2 characters. Up/Down to navigate, Enter to open.
            </p>
          )}
          {q.trim().length >= 2 && results && flat.length === 0 && !busy && (
            <p className="p-6 text-center text-xs text-slate-400">
              No matches.
            </p>
          )}
          {flat.length > 0 && (
            <ResultList hits={flat} activeIdx={active}
              onHover={setActive} onPick={onPick} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultList({ hits, activeIdx, onHover, onPick }: {
  hits: SearchHit[]; activeIdx: number;
  onHover: (i: number) => void; onPick: (h: SearchHit) => void;
}) {
  // Active row should always be visible.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  let lastSection = '';
  return (
    <div ref={ref}>
      {hits.map((h, i) => {
        const section = h.type === 'card' ? 'CARDS'
          : h.type === 'member' ? 'MEMBERS' : 'REPORTS';
        const showHeader = section !== lastSection;
        lastSection = section;
        return (
          <React.Fragment key={`${h.type}-${(h as any)[h.type]?.id ?? i}`}>
            {showHeader && (
              <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {section}
              </div>
            )}
            <button data-idx={i}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(h)}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 ${i === activeIdx ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
              {h.type === 'card' && (
                <>
                  <Kanban className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800 truncate">{h.card.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {h.card.board_name} · {h.card.column_name}
                    </div>
                  </div>
                </>
              )}
              {h.type === 'report' && (
                <>
                  <ClipboardList className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800 truncate">
                      {h.report.subscriber_name} · {h.report.report_date}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {(h.report.goals || h.report.mid_progress || h.report.eod_completed || '').slice(0, 80)}
                    </div>
                  </div>
                </>
              )}
              {h.type === 'member' && (
                <>
                  <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800 truncate">{h.member.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {h.member.role || '—'} {h.member.active ? '' : '· paused'}
                    </div>
                  </div>
                </>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function ShortcutCheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400 hover:text-slate-700" /></button>
        </div>
        <ul className="px-5 py-4 space-y-2 text-sm">
          <Row keys={['⌘', 'K']} label="Open search" />
          <Row keys={['Ctrl', 'K']} label="Open search (Win/Linux)" />
          <Row keys={['?']} label="Show this cheatsheet" />
          <Row keys={['Esc']} label="Close any modal" />
          <Row keys={['↑', '↓']} label="Move within search results" />
          <Row keys={['Enter']} label="Open the highlighted result" />
        </ul>
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-slate-700">{label}</span>
      <span className="flex gap-1">
        {keys.map((k, i) => (
          <kbd key={i} className="text-[11px] text-slate-600 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5 font-mono">
            {k}
          </kbd>
        ))}
      </span>
    </li>
  );
}
