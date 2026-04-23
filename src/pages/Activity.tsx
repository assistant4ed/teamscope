import React, { useEffect, useState } from 'react';
import { apiGet } from '../auth';
import { RefreshCw, MessageSquare, Send, Check, AlertTriangle, Bot } from 'lucide-react';

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

export default function Activity() {
  const [tab, setTab] = useState<'actions' | 'classifications'>('actions');
  const [actions, setActions] = useState<Action[]>([]);
  const [clas, setClas] = useState<Classification[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'actions') {
        const r = await apiGet<{ actions: Action[] }>('/api/agent/actions?limit=100');
        setActions(r.actions);
      } else {
        const r = await apiGet<{ classifications: Classification[] }>('/api/agent/classifications?limit=100');
        setClas(r.classifications);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [tab]);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
          <p className="text-sm text-slate-500">Audit trail of everything the AI has classified or executed.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
            <button onClick={() => setTab('actions')}
              className={`px-3 py-1 text-sm rounded ${tab==='actions'?'bg-slate-900 text-white':'text-slate-600'}`}>
              Actions
            </button>
            <button onClick={() => setTab('classifications')}
              className={`px-3 py-1 text-sm rounded ${tab==='classifications'?'bg-slate-900 text-white':'text-slate-600'}`}>
              Classifications
            </button>
          </div>
          <button onClick={load}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
        </div>
      </div>

      {tab === 'actions' ? (
        <ActionsList items={actions} />
      ) : (
        <ClassificationsList items={clas} />
      )}
    </div>
  );
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
