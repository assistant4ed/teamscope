import React, { useState } from 'react';
import {
  LayoutDashboard, ListChecks, ClipboardList, Users, LogOut, Menu, X,
  Bot, Activity as ActivityIcon, Kanban,
} from 'lucide-react';
import { Me, signOut } from './auth';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Board from './pages/Board';
import Reports from './pages/Reports';
import Team from './pages/Team';
import Agent from './pages/Agent';
import Activity from './pages/Activity';

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

export default function Shell({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [open, setOpen] = useState(false);

  const Page = {
    dashboard: <Dashboard />,
    board:     <Board me={me} />,
    agent:     <Agent me={me} />,
    tasks:     <Tasks me={me} />,
    reports:   <Reports me={me} />,
    activity:  <Activity />,
    team:      <Team me={me} />,
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
          <nav className="flex-1 p-3">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => { setTab(n.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                  ${tab === n.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'}`}>
                {n.icon}{n.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-2 truncate">{me.email}</div>
            <div className="text-xs text-indigo-600 font-medium mb-3">role: {me.role}</div>
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
    </div>
  );
}
