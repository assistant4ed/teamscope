import React, { useState, useRef, useEffect } from 'react';
import { apiPost, apiFetch, Me } from '../auth';
import {
  Send, Loader2, Bot, User as UserIcon, ChevronDown, ChevronUp, FlaskConical,
} from 'lucide-react';

interface Classification {
  domain: string;
  action: string;
  confidence: number;
  assignee: 'self' | 'boss' | 'pa' | 'manus';
  requires_approval: boolean;
  priority: string;
  suggested_response: string;
  entities?: Record<string, unknown>;
  reasoning?: string;
  missing_info?: string[];
  execution_plan?: Array<{ step: string; tool: string; params?: Record<string, unknown> }>;
}

interface Turn {
  id: string;
  role: 'user' | 'agent';
  text?: string;
  classification?: Classification;
  action_taken?: string;
  error?: string;
  at: number;
}

export default function Agent({ me }: { me: Me }) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const uid = Math.random().toString(36).slice(2, 9);
    setTurns(t => [...t, { id: uid, role: 'user', text, at: Date.now() }]);
    setInput('');
    setLoading(true);
    try {
      const r = await apiPost<{ classification: Classification; action_taken: string; correlation_id: string; classify_error?: string }>(
        '/api/agent/message', { text }
      );
      setTurns(t => [...t, {
        id: uid + '-r',
        role: 'agent',
        classification: r.classification,
        action_taken: r.action_taken,
        error: r.classify_error,
        at: Date.now(),
      }]);
    } catch (err) {
      setTurns(t => [...t, { id: uid + '-e', role: 'agent', error: String(err), at: Date.now() }]);
    } finally { setLoading(false); }
  }

  const canUseClassifier = me.role === 'boss' || me.role === 'pa';
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 md:px-10 pt-6 pb-3 border-b border-slate-200 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">AI Agent</h1>
        <p className="text-sm text-slate-500">
          Send a task. Claude classifies + routes to PA / Manus / auto-execute.
          Same brain as <code>@edpapabot</code>, without Telegram.
        </p>
        {canUseClassifier && <ReportClassifierPanel />}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-10 py-6 space-y-4 bg-slate-50">
        {turns.length === 0 && (
          <EmptyState email={me.email!} />
        )}
        {turns.map(t => t.role === 'user' ? (
          <UserBubble key={t.id} text={t.text!} />
        ) : (
          <AgentBubble key={t.id}
            classification={t.classification}
            action_taken={t.action_taken}
            error={t.error} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Claude is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit}
        className="p-4 md:px-10 md:py-4 border-t border-slate-200 bg-white flex gap-2">
        <textarea
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
          }}
          placeholder="Ask anything: text Meghan, invoice Bamboo SGD 4500, research KL coworking spaces..."
          className="flex-1 resize-none border border-slate-200 rounded-xl px-4 py-3 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" disabled={loading || !input.trim()}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white
                     px-4 rounded-xl flex items-center gap-2 text-sm font-medium">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </button>
      </form>
    </div>
  );
}

const UserBubble = ({ text }: { text: string }) => (
  <div className="flex justify-end">
    <div className="max-w-2xl flex items-start gap-2">
      <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
        {text}
      </div>
      <div className="w-8 h-8 rounded-full bg-slate-200 grid place-items-center flex-shrink-0">
        <UserIcon className="w-4 h-4 text-slate-600" />
      </div>
    </div>
  </div>
);

const AgentBubble = ({ classification, action_taken, error }: {
  classification?: Classification; action_taken?: string; error?: string;
}) => {
  if (error && !classification) {
    return (
      <div className="flex items-start gap-2 max-w-2xl">
        <div className="w-8 h-8 rounded-full bg-rose-100 grid place-items-center flex-shrink-0">
          <Bot className="w-4 h-4 text-rose-700" />
        </div>
        <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm">
          {error}
        </div>
      </div>
    );
  }
  const c = classification!;
  const badge = (
    c.assignee === 'manus' ? 'indigo' :
    c.assignee === 'pa'    ? 'emerald' :
    c.assignee === 'boss'  ? 'amber' : 'slate'
  );
  return (
    <div className="flex items-start gap-2 max-w-3xl">
      <div className="w-8 h-8 rounded-full bg-slate-200 grid place-items-center flex-shrink-0">
        <Bot className="w-4 h-4 text-slate-700" />
      </div>
      <div className="flex-1 space-y-2">
        {c.suggested_response && (
          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-slate-800 whitespace-pre-wrap">
            {c.suggested_response}
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <Tag color={badge}>{c.assignee}</Tag>
          <Tag color="slate">{c.domain}/{c.action}</Tag>
          <Tag color="slate">conf {Math.round(c.confidence * 100)}%</Tag>
          {c.requires_approval && <Tag color="amber">needs approval</Tag>}
          {action_taken && action_taken !== 'logged' && (
            <Tag color="emerald">✓ {action_taken.replace(/_/g, ' ')}</Tag>
          )}
          {c.priority && c.priority !== 'medium' && <Tag color="slate">{c.priority}</Tag>}
        </div>
        {c.reasoning && (
          <details className="text-xs text-slate-500 mt-1">
            <summary className="cursor-pointer hover:text-slate-700">reasoning</summary>
            <div className="pt-2 leading-relaxed">{c.reasoning}</div>
          </details>
        )}
        {c.execution_plan && c.execution_plan.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-700">
              execution plan ({c.execution_plan.length} step{c.execution_plan.length > 1 ? 's' : ''})
            </summary>
            <ul className="pt-2 space-y-1">
              {c.execution_plan.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <code className="text-slate-400">{i + 1}.</code>
                  <code className="text-slate-600">{s.tool}</code>
                  <span className="text-slate-500">{s.step}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
};

const Tag = ({ color, children }: { color: string; children: React.ReactNode }) => {
  const cls: Record<string, string> = {
    indigo:  'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber:   'bg-amber-50 text-amber-700',
    slate:   'bg-slate-100 text-slate-700',
    rose:    'bg-rose-50 text-rose-700',
  };
  return <span className={`px-2 py-0.5 rounded-full ${cls[color] || cls.slate}`}>{children}</span>;
};

// Lets a boss/PA paste a hypothetical Telegram reply and see how the
// classifier labels it before wiring n8n. Collapsed by default so it
// doesn't clutter the main chat flow.
function ReportClassifierPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [slot, setSlot] = useState<'morning' | 'midday' | 'eod'>('morning');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function classify() {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const res = await apiFetch('/api/agent/classify-report', {
        method: 'POST',
        body: JSON.stringify({ text, slot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      setResult(body);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const kind = result?.kind as string | undefined;
  const kindColor =
    kind === 'task'          ? 'bg-amber-100 text-amber-800 border-amber-200' :
    kind === 'chatter'       ? 'bg-slate-100 text-slate-700 border-slate-200' :
    kind?.startsWith('report') ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium
                   text-indigo-700 hover:text-indigo-900">
        <FlaskConical className="w-3.5 h-3.5" />
        Report classifier (test)
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Paste a hypothetical subscriber reply below, pick the slot it would have arrived on,
            and see how the classifier labels it. Use to QA the classifier before n8n wires it in.
          </p>
          <div className="flex gap-2">
            <select value={slot} onChange={e => setSlot(e.target.value as typeof slot)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="morning">Morning</option>
              <option value="midday">Midday</option>
              <option value="eod">End of day</option>
            </select>
            <textarea value={text} onChange={e => setText(e.target.value)}
              rows={3} placeholder='e.g. "tell Meghan to plan my trip to Malaysia"'
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={classify} disabled={busy || !text.trim()}
              className="px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                         disabled:opacity-40 text-white rounded-lg self-stretch">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Classify'}
            </button>
          </div>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs items-center">
                <span className={`px-2 py-0.5 rounded-full border font-medium ${kindColor}`}>
                  {kind || '?'}
                </span>
                {typeof result.confidence === 'number' && (
                  <span className="text-slate-500">
                    conf {Math.round((result.confidence as number) * 100)}%
                  </span>
                )}
                {typeof result.summary === 'string' && (
                  <span className="text-slate-700 italic">"{result.summary as string}"</span>
                )}
              </div>
              <pre className="text-[11px] bg-white border border-slate-200 rounded-lg p-2 overflow-x-auto leading-snug">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EmptyState = ({ email }: { email: string }) => (
  <div className="max-w-xl mx-auto mt-10 space-y-4 text-slate-600 text-sm">
    <div className="text-center">
      <Bot className="w-8 h-8 mx-auto text-indigo-500 mb-2" />
      <div className="font-medium text-slate-800">Hi {email.split('@')[0]}.</div>
      <div className="text-slate-500 mt-0.5">Try one of these:</div>
    </div>
    <div className="grid gap-2">
      {[
        'text Meghan about dinner tomorrow at 7',
        'research 3 coworking spaces in KL with phone booths',
        'today tasks for Meghan: book dentist, buy stamps, call grandma',
        'invoice Bamboo Studio SGD 4500 for website rebuild',
      ].map((s, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-700">
          <code className="text-xs text-slate-400 mr-2">#{i+1}</code>{s}
        </div>
      ))}
    </div>
  </div>
);
