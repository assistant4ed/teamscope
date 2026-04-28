import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, ListChecks, ClipboardList, Users, LogOut, Menu, X,
  Bot, Activity as ActivityIcon, Kanban, Search,
} from 'lucide-react';
import { Me, signOut } from './auth';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Board from './pages/Board';
import Reports from './pages/Reports';
import Team from './pages/Team';
import Member from './pages/Member';
import Agent from './pages/Agent';
import Activity from './pages/Activity';
import SearchPalette, { ShortcutCheatsheet, type SearchHit } from './SearchPalette';
import NotificationsBell from './NotificationsBell';

type Tab = 'dashboard' | 'agent' | 'board' | 'tasks' | 'reports' | 'activity' | 'team';

const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard',    icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: 'board',     label: 'Board',        icon: <Kanban          className="w-5 h-5" /> },
  { id: 'agent',     label: 'AI Agent',     icon: <Bot             className="w-5 h-5" /> },
  { id: 'tasks',     label: 'Queue',        icon: <ListChecks      className="w-5 h-5" /> },
  { id: 'reports',   label: 'Work Reports', icon: <ClipboardList   className="w-5 h-5" /> },
  { id: 'activity',  label: 'Activity',     icon: <ActivityIcon    className="w-5 h-5" /> },
  { id: 'team',      label: 'Team',         icon: <Users           className="w-5 h-5" /> },
];

function isTextInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export default function Shell({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [open, setOpen] = useState(false);
  // When non-null the main pane swaps in the Member detail page.
  // Kept parallel to `tab` so the sidebar still highlights "Team".
  const [memberId, setMemberId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);

  // Global keyboard shortcuts. ⌘/Ctrl+K opens search; "?" opens cheatsheet
  // (only when user isn't currently typing into a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (cmdK) {
        e.preventDefault();
        setSearchOpen(true);
        setCheatOpen(false);
        return;
      }
      if (e.key === '?' && !isTextInput(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCheatOpen(true);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pickResult(hit: SearchHit) {
    setSearchOpen(false);
    if (hit.type === 'card') {
      // Switch to Board; deeper nav (open card modal) would need state
      // plumbing into Board — leave the "click the card" gesture to user
      // for v1. They land on the right board at least.
      setTab('board');
      setMemberId(null);
    } else if (hit.type === 'report') {
      setTab('reports');
      setMemberId(null);
    } else if (hit.type === 'member') {
      setMemberId(hit.member.id);
      setTab('team');
    }
  }

  const Page = memberId ? (
    <Member me={me} subscriberId={memberId}
      onBack={() => { setMemberId(null); setTab('team'); }} />
  ) : {
    dashboard: <Dashboard me={me} />,
    board:     <Board me={me} />,
    agent:     <Agent me={me} />,
    tasks:     <Tasks me={me} />,
    reports:   <Reports me={me} />,
    activity:  <Activity />,
    team:      <Team me={me} onOpenMember={id => setMemberId(id)} />,
  }[tab];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <aside className={`${open ? 'fixed inset-0 z-40' : 'hidden'} md:static md:flex md:flex-col md:w-60 md:border-r md:border-slate-200 bg-white`}>
        {open && (
          <div className="absolute inset-0 bg-slate-900/40 md:hidden" onClick={() => setOpen(false)} />
        )}
        <div className="relative bg-white h-full md:h-auto w-60 md:w-auto flex flex-col">
          <div className="p-5 border-b border-slate-100">
            <div className="text-lg font-bold tracking-tight">TeamScope</div>
            <div className="text-xs text-slate-500 mt-0.5">DeFiner Ops</div>
          </div>
          <button onClick={() => setSearchOpen(true)}
            className="mx-3 mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500
                       border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-700">
            <Search className="w-3.5 h-3.5" />
            Search…
            <kbd className="ml-auto text-[10px] text-slate-400 border border-slate-200 rounded px-1 py-0.5">⌘K</kbd>
          </button>
          <nav className="flex-1 p-3">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => { setTab(n.id); setMemberId(null); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                  ${tab === n.id && !memberId
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'}`}>
                {n.icon}{n.label}
              </button>
            ))}
          </nav>
          <div className="px-3 pb-1">
            <NotificationsBell />
          </div>
          <div className="p-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-2 truncate">{me.email}</div>
            <div className="text-xs text-indigo-600 font-medium mb-2">role: {me.role}</div>
            <button onClick={() => setCheatOpen(true)}
              className="w-full text-left text-[11px] text-slate-400 hover:text-slate-700 mb-2">
              Press <kbd className="px-1 border border-slate-200 rounded">?</kbd> for shortcuts
            </button>
            <button onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="md:hidden sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-10">
          <div className="font-bold">TeamScope</div>
          <button onClick={() => setOpen(!open)}>
            {open ? <X className="w-6 h-6"/> : <Menu className="w-6 h-6"/>}
          </button>
        </div>
        {Page}
      </main>

      {searchOpen && (
        <SearchPalette onPick={pickResult} onClose={() => setSearchOpen(false)} />
      )}
      {cheatOpen && (
        <ShortcutCheatsheet onClose={() => setCheatOpen(false)} />
      )}
    </div>
  );
}
