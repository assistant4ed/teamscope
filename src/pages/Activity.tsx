import React, { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../auth';
import {
  RefreshCw, MessageSquare, Send, Check, AlertTriangle, Bot,
  Kanban, Users, ArrowRight, Edit3, Trash2, UserPlus, UserMinus,
} from 'lucide-react';

interface Action {
  id: string;
  correlation_id: string;
  domain: string;
  action: string;
  executor: string;
  outcome: string;
  created_at: string;
  requester_name: string | null;
}

interface Classification {
  id: string;
  domain: string;
  action: string;
  confidence: number;
  assignee: string;
  requires_approval: boolean;
  priority: string;
  created_at: string;
  source_text: string | null;
  channel: string | null;
}

interface BoardEvent {
  id: string;
  card_id: string | null;
  card_title: string | null;
  actor_email: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  source: 'kanban';
}

interface Subscriber {
  id: string; name: string; role: string | null;
  timezone: string; active: boolean;
}

type Tab = 'board' | 'actions' | 'classifications';

export default function Activity() {
  const [tab, setTab] = useState<Tab>('board');
  const [actions, setActions] = useState<Action[]>([]);
  const [clas, setClas] = useState<Classification[]>([]);
  const [events, setEvents] = useState<BoardEvent[]>([]);
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [filterSub, setFilterSub] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const subsById = useMemo(() => {
    const m = new Map<string, Subscriber>();
    subs.forEach(s => m.set(s.id, s));
    return m;
  }, [subs]);

  // Subscribers only need to be fetched once.
  useEffect(() => {
    apiGet<{ subscribers: Subscriber[] }>('/api/team')
      .then(d => setSubs(d.subscribers))
      .catch(() => {/* non-fatal */});
  }, []);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'board') {
        const qs = new URLSearchParams({ limit: '200' });
        if (filterSub) qs.set('subscriber_id', filterSub);
        const r = await apiGet<{ events: BoardEvent[] }>(`/api/activity?${qs}`);
        setEvents(r.events);
      } else if (tab === 'actions') {
        const r = await apiGet<{ actions: Action[] }>('/api/agent/actions?limit=100');
        setActions(r.actions);
      } else {
        const r = await apiGet<{ classifications: Classification[] }>('/api/agent/classifications?limit=100');
        setClas(r.classifications);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [tab, filterSub]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
          <p className="text-sm text-slate-500">
            Everything the team and AI did, in one timeline.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === 'board' && (
            <label className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <select value={filterSub ?? ''} onChange={e => setFilterSub(e.target.value || null)}
                className="bg-transparent outline-none text-slate-700">
                <option value="">Everyone</option>
                {subs.filter(s => s.active).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
            <TabBtn active={tab==='board'} onClick={() => setTab('board')}>Board</TabBtn>
            <TabBtn active={tab==='actions'} onClick={() => setTab('actions')}>AI Actions</TabBtn>
            <TabBtn active={tab==='classifications'} onClick={() => setTab('classifications')}>Classifications</TabBtn>
          </div>
          <button onClick={load}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 bg-white">
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
        </div>
      </div>

      {tab === 'board' && (
        <BoardEventsList events={events} subsById={subsById} />
      )}
      {tab === 'actions' && <ActionsList items={actions} />}
      {tab === 'classifications' && <ClassificationsList items={clas} />}
    </div>
  );
}

const TabBtn = ({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) => (
  <button onClick={onClick}
    className={`px-3 py-1 text-sm rounded ${active?'bg-slate-900 text-white':'text-slate-600'}`}>
    {children}
  </button>
);

// ---------- Board events list --------------------------------------- //
function BoardEventsList({ events, subsById }: {
  events: BoardEvent[]; subsById: Map<string, Subscriber>;
}) {
  if (events.length === 0) return <Empty>No Board activity yet — move a card to start the history.</Empty>;
  // Group events by date (local) so staff can scan by day.
  const groups = new Map<string, BoardEvent[]>();
  for (const e of events) {
    const d = new Date(e.created_at).toDateString();
    const arr = groups.get(d) || [];
    arr.push(e);
    groups.set(d, arr);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([day, items]) => (
        <section key={day}>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {dateLabel(new Date(day))}
          </h3>
          <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            {items.map(e => (
              <BoardEventRow key={e.id} event={e} subsById={subsById} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BoardEventRow({ event, subsById }: {
  event: BoardEvent; subsById: Map<string, Subscriber>;
}) {
  const at = new Date(event.created_at);
  return (
    <li className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50">
      <BoardEventIcon action={event.action} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800">
          <b>{shortActor(event.actor_email)}</b> {boardEventSentence(event, subsById)}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {event.card_title && <> · <span className="text-slate-500">{event.card_title}</span></>}
        </div>
      </div>
    </li>
  );
}

function boardEventSentence(e: BoardEvent, subsById: Map<string, Subscriber>): React.ReactNode {
  const p = e.payload;
  switch (e.action) {
    case 'card.created':
      return <>created a card{p.title ? <> titled <i>"{String(p.title)}"</i></> : ''}</>;
    case 'card.updated':
      return <>updated the card{e.card_title ? <> <i>"{e.card_title}"</i></> : ''}</>;
    case 'card.moved': {
      return <>moved the card to a new column{p.is_done ? <> (done)</> : null}</>;
    }
    case 'card.done': return <>marked the card done</>;
    case 'card.reopened': return <>reopened the card</>;
    case 'card.assigned': {
      const name = resolveSub(p.subscriber_id as string, subsById);
      return <>assigned {name ?? 'someone'}</>;
    }
    case 'card.unassigned': {
      const name = resolveSub(p.subscriber_id as string, subsById);
      return <>removed {name ?? 'an assignee'}</>;
    }
    case 'card.deleted':
      return <>deleted a card{p.title ? <> <i>"{String(p.title)}"</i></> : ''}</>;
    case 'column.created': return <>added a new column</>;
    case 'column.renamed': return <>renamed a column</>;
    case 'column.reordered': return <>reordered the columns</>;
    case 'column.deleted': return <>removed a column</>;
    default: return <>performed {e.action}</>;
  }
}

function resolveSub(id: string | undefined, subsById: Map<string, Subscriber>) {
  if (!id) return null;
  return subsById.get(id)?.name || null;
}

const BoardEventIcon = ({ action }: { action: string }) => {
  const [bg, fg, Icon] = iconFor(action);
  return (
    <div className={`w-8 h-8 rounded-full ${bg} grid place-items-center flex-shrink-0`}>
      <Icon className={`w-4 h-4 ${fg}`} />
    </div>
  );
};

function iconFor(action: string): [string, string, typeof Kanban] {
  if (action === 'card.done')       return ['bg-emerald-100', 'text-emerald-700', Check];
  if (action === 'card.deleted' || action === 'column.deleted') return ['bg-rose-100', 'text-rose-700', Trash2];
  if (action === 'card.assigned')   return ['bg-indigo-100', 'text-indigo-700', UserPlus];
  if (action === 'card.unassigned') return ['bg-slate-100', 'text-slate-600', UserMinus];
  if (action === 'card.moved')      return ['bg-slate-100', 'text-slate-700', ArrowRight];
  if (action === 'card.updated')    return ['bg-slate-100', 'text-slate-700', Edit3];
  return ['bg-slate-100', 'text-slate-600', Kanban];
}

function shortActor(email: string): string {
  return email.split('@')[0];
}

function dateLabel(d: Date): string {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const ActionsList = ({ items }: { items: Action[] }) => {
  if (items.length === 0) return <Empty>No agent activity yet.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl overflow-hidden">
      {items.map(a => (
        <li key={a.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50">
          <ActionIcon action={a.action} outcome={a.outcome} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-800">{a.action.replace(/_/g, ' ')}</span>
              <span className="text-xs text-slate-400">/ {a.domain}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
              <code className="text-slate-400">{a.correlation_id}</code>
              <span>·</span>
              <span>by {a.executor}</span>
              {a.requester_name && <><span>·</span><span>from {a.requester_name}</span></>}
              <span>·</span>
              <span>{new Date(a.created_at).toLocaleString()}</span>
            </div>
          </div>
          <OutcomePill outcome={a.outcome} />
        </li>
      ))}
    </ul>
  );
};

const ClassificationsList = ({ items }: { items: Classification[] }) => {
  if (items.length === 0) return <Empty>No classifications yet.</Empty>;
  return (
    <ul className="space-y-2">
      {items.map(c => (
        <li key={c.id} className="bg-white border border-slate-200 rounded-xl p-4">
          {c.source_text && (
            <div className="text-sm text-slate-800 mb-2 line-clamp-2">
              <MessageSquare className="w-3 h-3 inline mr-1 text-slate-400" />
              {c.source_text}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Tag color="slate">{c.domain}/{c.action}</Tag>
            <Tag color={
              c.assignee === 'manus' ? 'indigo' :
              c.assignee === 'pa'    ? 'emerald' :
              c.assignee === 'boss'  ? 'amber' : 'slate'
            }>{c.assignee}</Tag>
            <Tag color="slate">conf {Math.round(c.confidence * 100)}%</Tag>
            {c.requires_approval && <Tag color="amber">approval</Tag>}
            {c.priority && c.priority !== 'medium' && <Tag color="slate">{c.priority}</Tag>}
            <Tag color="slate">{c.channel || 'telegram'}</Tag>
            <span className="text-slate-400 ml-auto">{new Date(c.created_at).toLocaleString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
};

const ActionIcon = ({ action, outcome }: { action: string; outcome: string }) => {
  if (outcome === 'success' || outcome === 'completed') {
    return <div className="w-8 h-8 rounded-full bg-emerald-100 grid place-items-center"><Check className="w-4 h-4 text-emerald-700" /></div>;
  }
  if (outcome === 'failure') {
    return <div className="w-8 h-8 rounded-full bg-rose-100 grid place-items-center"><AlertTriangle className="w-4 h-4 text-rose-700" /></div>;
  }
  if (action.includes('manus') || action.includes('delegate')) {
    return <div className="w-8 h-8 rounded-full bg-indigo-100 grid place-items-center"><Bot className="w-4 h-4 text-indigo-700" /></div>;
  }
  return <div className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center"><Send className="w-4 h-4 text-slate-700" /></div>;
};

const OutcomePill = ({ outcome }: { outcome: string }) => {
  const cls: Record<string, string> = {
    success:    'bg-emerald-50 text-emerald-700',
    completed:  'bg-emerald-50 text-emerald-700',
    failure:    'bg-rose-50 text-rose-700',
    dispatched: 'bg-indigo-50 text-indigo-700',
    pending:    'bg-amber-50 text-amber-700',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls[outcome] || 'bg-slate-50 text-slate-700'}`}>{outcome}</span>;
};

const Tag = ({ color, children }: { color: string; children: React.ReactNode }) => {
  const cls: Record<string, string> = {
    indigo:  'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber:   'bg-amber-50 text-amber-700',
    slate:   'bg-slate-100 text-slate-700',
  };
  return <span className={`px-2 py-0.5 rounded-full ${cls[color] || cls.slate}`}>{children}</span>;
};

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="py-16 text-center text-slate-400 bg-white border border-slate-200 rounded-xl">{children}</div>
);
