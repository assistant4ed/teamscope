import React, { useState, useRef, useEffect } from 'react';
import { apiPost, apiFetch, Me } from '../auth';
import {
  Send, Loader2, Bot, User as UserIcon, ChevronDown, ChevronUp, FlaskConical,
  Kanban, Check, Compass, Copy, RotateCcw, FileText, Search, MessageSquare,
  Image as ImageIcon, X as XIcon,
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
        {canUseClassifier && <SmartRouterPanel me={me} />}
        {canUseClassifier && <ImageRouterPanel me={me} />}
        {canUseClassifier && <ReportClassifierPanel />}
        <SendToBoardPanel />
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

// ---------- Smart Router ------------------------------------------ //
// Reads any message, classifies intent, and proposes one concrete
// action the boss can apply with a click. This is the canonical flow
// going forward — n8n calls the same /api/agent/route-message endpoint
// from Telegram so the bot does the same thing whether you're typing
// here or DM'ing it.

type RouteIntent =
  'answer' | 'report_self' | 'plan_self' | 'delegate'
  | 'research' | 'status_query' | 'chatter' | 'ambiguous';

interface RouteCard {
  title: string; description?: string;
  assignee_name?: string | null; priority?: string;
  due_date?: string | null;
}
type RouteAction =
  | ({ type: 'create_kanban_card' } & RouteCard)
  | { type: 'create_kanban_cards'; cards: RouteCard[] }
  | { type: 'log_report'; slot: 'morning' | 'midday' | 'eod';
      field: 'goals' | 'mid_progress' | 'eod_completed' | 'eod_unfinished';
      value: string }
  | { type: 'create_research_task'; title: string; brief: string }
  | { type: 'create_finance_task'; vendor: string; amount: number;
      currency: string; date?: string | null; category?: string };

interface RouteResult {
  intent: RouteIntent;
  confidence: number;
  summary: string;
  reply: string;
  action: RouteAction | null;
}

function SmartRouterPanel({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [senderName, setSenderName] = useState((me.email || '').split('@')[0] || 'me');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function route() {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null); setApplyState('idle');
    try {
      const res = await apiFetch('/api/agent/route-message', {
        method: 'POST',
        body: JSON.stringify({ text, sender_name: senderName, sender_role: me.role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      setResult(body as RouteResult);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function applyAction() {
    if (!result?.action) return;
    setApplyState('busy'); setErr(null);
    try {
      if (result.action.type === 'create_kanban_card') {
        await postCreateCard(text, result.action.assignee_name);
      } else if (result.action.type === 'create_kanban_cards') {
        for (const c of result.action.cards) {
          // Re-derive a per-card prompt so the backend can resolve
          // assignee/due. Using the card's own title keeps it simple.
          await postCreateCard(c.title, c.assignee_name);
        }
      } else if (result.action.type === 'create_research_task') {
        await postCreateCard(`RESEARCH: ${result.action.title} — ${result.action.brief}`, null);
      } else if (result.action.type === 'create_finance_task') {
        const a = result.action;
        await postCreateCard(
          `Pay ${a.vendor} ${a.currency} ${a.amount}` +
          (a.date ? ` (receipt ${a.date})` : '') +
          (a.category ? ` — ${a.category}` : '') +
          ' high priority',
          null
        );
      } else if (result.action.type === 'log_report') {
        // No upsert endpoint yet — copy text into clipboard for the
        // boss to paste into Reports → slot inline editor.
        await navigator.clipboard.writeText(result.action.value).catch(() => {});
      }
      setApplyState('done');
    } catch (e) { setErr((e as Error).message); setApplyState('idle'); }
  }

  async function postCreateCard(text: string, assigneeName: string | null | undefined) {
    const res = await apiFetch('/api/agent/create-card', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
    }
    void assigneeName; // create-card re-extracts assignee from the text itself
  }

  const intentColor: Record<RouteIntent, string> = {
    answer:       'bg-sky-100 text-sky-800 border-sky-200',
    report_self:  'bg-emerald-100 text-emerald-800 border-emerald-200',
    plan_self:    'bg-indigo-100 text-indigo-800 border-indigo-200',
    delegate:     'bg-amber-100 text-amber-800 border-amber-200',
    research:     'bg-purple-100 text-purple-800 border-purple-200',
    status_query: 'bg-slate-100 text-slate-700 border-slate-200',
    chatter:      'bg-slate-100 text-slate-600 border-slate-200',
    ambiguous:    'bg-rose-100 text-rose-800 border-rose-200',
  };

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium
                   text-indigo-700 hover:text-indigo-900">
        <Compass className="w-3.5 h-3.5" />
        Smart router
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Reads a message the way @edpapabot does on Telegram, picks one of
            8 intents, and proposes a single concrete action you can apply
            with a click.
          </p>
          <div className="flex gap-2">
            <input value={senderName} onChange={e => setSenderName(e.target.value)}
              placeholder="sender"
              className="w-32 border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white" />
            <textarea value={text} onChange={e => setText(e.target.value)}
              rows={2}
              placeholder='e.g. "my schedule today: A, B, C" · "tell Andrea to ship the deck Friday"'
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={route} disabled={busy || !text.trim()}
              className="px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                         disabled:opacity-40 text-white rounded-lg self-stretch">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Route'}
            </button>
          </div>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
          {result && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${intentColor[result.intent]}`}>
                  {result.intent}
                </span>
                <span className="text-xs text-slate-500">
                  conf {Math.round((result.confidence ?? 0) * 100)}%
                </span>
                <button onClick={() => { setText(text); setResult(null); setApplyState('idle'); }}
                  title="Edit and re-route"
                  className="ml-auto text-xs text-slate-400 hover:text-slate-700 inline-flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> redo
                </button>
              </div>
              <div className="text-sm text-slate-700 italic">"{result.summary}"</div>
              {result.reply && (
                <blockquote className="text-xs text-slate-600 bg-slate-50 border-l-2 border-slate-300 pl-2.5 py-1.5">
                  <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] mb-0.5">
                    Bot would reply:
                  </div>
                  {result.reply}
                </blockquote>
              )}
              <ActionPlanCard action={result.action}
                onApply={applyAction} applyState={applyState} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionPlanCard({ action, onApply, applyState }: {
  action: RouteAction | null;
  onApply: () => void;
  applyState: 'idle' | 'busy' | 'done';
}) {
  if (!action) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-2 inline-flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" />
        Reply only — nothing to record.
      </div>
    );
  }

  const summary = (() => {
    if (action.type === 'create_kanban_card') {
      return (
        <>Create a Today card: <b>{action.title}</b>
        {action.assignee_name && <> · assigned to <b>{action.assignee_name}</b></>}
        {action.priority && action.priority !== 'medium' && <> · {action.priority}</>}
        {action.due_date && <> · due {action.due_date}</>}</>
      );
    }
    if (action.type === 'create_kanban_cards') {
      return (
        <>Create {action.cards.length} Today cards:
          <ul className="list-disc ml-5 mt-1">
            {action.cards.map((c, i) => (
              <li key={i}><b>{c.title}</b>{c.assignee_name && <> → {c.assignee_name}</>}</li>
            ))}
          </ul>
        </>
      );
    }
    if (action.type === 'log_report') {
      return (
        <>Record into <b>{action.field}</b> on the {action.slot} slot:
          <div className="mt-1 italic">"{action.value}"</div>
        </>
      );
    }
    if (action.type === 'create_finance_task') {
      return (
        <>Receipt — pay <b>{action.vendor}</b> <b>{action.currency} {action.amount.toLocaleString()}</b>
          {action.date && <> · dated {action.date}</>}
          {action.category && <> · {action.category}</>}
          <div className="text-slate-500 text-xs mt-0.5">
            Creates a high-priority Today card for finance follow-up.
          </div>
        </>
      );
    }
    return (
      <>Surface a research task: <b>{action.title}</b>
        <div className="text-slate-500 text-xs mt-0.5">{action.brief}</div>
      </>
    );
  })();

  const icon =
    action.type === 'create_kanban_card'   ? <Kanban className="w-3.5 h-3.5" /> :
    action.type === 'create_kanban_cards'  ? <Kanban className="w-3.5 h-3.5" /> :
    action.type === 'log_report'           ? <FileText className="w-3.5 h-3.5" /> :
    action.type === 'create_finance_task'  ? <FileText className="w-3.5 h-3.5" /> :
    <Search className="w-3.5 h-3.5" />;

  const isLogReport = action.type === 'log_report';
  const applyLabel =
    applyState === 'done'  ? (isLogReport ? '✓ Copied' : '✓ Applied') :
    applyState === 'busy'  ? 'Applying…' :
    isLogReport            ? 'Copy text' :
    'Apply';

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm space-y-2">
      <div className="flex items-start gap-2 text-indigo-900">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1">{summary}</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onApply} disabled={applyState === 'busy' || applyState === 'done'}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium
                     bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg">
          {applyState === 'busy' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {applyState === 'done' && <Check className="w-3.5 h-3.5" />}
          {applyState === 'idle' && (isLogReport ? <Copy className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />)}
          {applyLabel}
        </button>
        {isLogReport && applyState === 'done' && (
          <span className="text-xs text-slate-500">paste into Reports page → slot editor</span>
        )}
      </div>
    </div>
  );
}

// Quick natural-language card creation. Anyone authed can use this —
// intent is the same flow n8n will call when a boss Telegram-messages
// the bot with "add task for Andrea: prepare slides".
function SendToBoardPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const res = await apiFetch('/api/agent/create-card', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      setResult(body);
      setText('');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const card = result?.card as { title?: string } | undefined;
  const parsed = result?.parsed as {
    assignee_name?: string | null; priority?: string;
    due_date?: string | null; description?: string | null;
  } | undefined;

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium
                   text-indigo-700 hover:text-indigo-900">
        <Kanban className="w-3.5 h-3.5" />
        Send to Board
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Describe the task in one sentence — Claude extracts the title, assignee,
            priority and due date and drops a card in the Today column.
            Same endpoint n8n will call from Telegram.
          </p>
          <div className="flex gap-2">
            <textarea value={text} onChange={e => setText(e.target.value)}
              rows={2}
              placeholder='e.g. "tell Andrea to prepare slides for Friday, high priority"'
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={submit} disabled={busy || !text.trim()}
              className="px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                         disabled:opacity-40 text-white rounded-lg self-stretch">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create card'}
            </button>
          </div>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
          {card && parsed && (
            <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-emerald-800">
                <Check className="w-3.5 h-3.5" />
                Card created: "{card.title}"
              </div>
              <div className="text-emerald-700 pl-5">
                {parsed.assignee_name
                  ? <>assigned to <b>{parsed.assignee_name}</b></>
                  : <>no assignee (name not matched)</>}
                {parsed.priority && parsed.priority !== 'medium' && <> · <b>{parsed.priority}</b> priority</>}
                {parsed.due_date && <> · due <b>{parsed.due_date}</b></>}
              </div>
              {parsed.description && (
                <div className="text-emerald-700 pl-5 italic">"{parsed.description}"</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Drop or paste an image, send it to the same intent router that
// powers /api/agent/route-message but with vision. Same shape result;
// boss can apply the proposed action or shrug it off.
interface ImageRouteResult {
  description: string;
  intent: string;
  confidence: number;
  summary: string;
  reply: string;
  action: RouteAction | null;
  image_url?: string | null;
}

function ImageRouterPanel({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>('image/jpeg');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImageRouteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<'idle' | 'busy' | 'done'>('idle');

  function pick(file: File) {
    if (!file.type.startsWith('image/')) {
      setErr('Not an image file'); return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Image too large (max 5 MB)'); return;
    }
    setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPreview(dataUrl);
      const [meta, b64] = dataUrl.split(',');
      const mt = (meta.match(/data:(.*?);base64/) ?? ['', 'image/jpeg'])[1];
      setMediaType(mt);
      setBase64(b64);
      setResult(null); setApplyState('idle');
    };
    reader.readAsDataURL(file);
  }

  function clear() {
    setPreview(null); setBase64(null); setResult(null); setApplyState('idle'); setErr(null);
  }

  async function analyze() {
    if (!base64 || busy) return;
    setBusy(true); setErr(null); setResult(null); setApplyState('idle');
    try {
      const res = await apiFetch('/api/agent/analyze-image', {
        method: 'POST',
        body: JSON.stringify({
          base64, media_type: mediaType,
          caption: caption || undefined,
          sender_name: (me.email || '').split('@')[0],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
      setResult(body as ImageRouteResult);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function applyAction() {
    if (!result?.action) return;
    setApplyState('busy'); setErr(null);
    // Append the persisted image URL so the resulting card's text
    // carries a clickable reference back to the original.
    const imageTag = result.image_url ? ` [image: ${result.image_url}]` : '';
    try {
      // Reuse the SmartRouter apply path: the actions are identical shapes.
      if (result.action.type === 'create_kanban_card') {
        await postCardFromText(buildCardPrompt(result.action) + imageTag);
      } else if (result.action.type === 'create_kanban_cards') {
        for (const c of result.action.cards) {
          await postCardFromText(buildCardPrompt(c) + imageTag);
        }
      } else if (result.action.type === 'create_research_task') {
        await postCardFromText(`RESEARCH: ${result.action.title} — ${result.action.brief}${imageTag}`);
      } else if (result.action.type === 'create_finance_task') {
        const a = result.action;
        await postCardFromText(
          `Pay ${a.vendor} ${a.currency} ${a.amount}` +
          (a.date ? ` (receipt ${a.date})` : '') +
          (a.category ? ` — ${a.category}` : '') +
          ' high priority' +
          imageTag
        );
      }
      setApplyState('done');
    } catch (e) { setErr((e as Error).message); setApplyState('idle'); }
  }

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium
                   text-indigo-700 hover:text-indigo-900">
        <ImageIcon className="w-3.5 h-3.5" />
        Image router
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Drop or pick an image — Claude vision describes it and proposes
            the same intents/actions as text messages. Same endpoint n8n will
            call when a Telegram photo arrives.
          </p>
          {!preview ? (
            <label className="block border-2 border-dashed border-slate-300 rounded-lg p-6 text-center
                              text-sm text-slate-500 hover:border-indigo-400 hover:bg-white cursor-pointer">
              <ImageIcon className="w-6 h-6 mx-auto text-slate-400 mb-1" />
              Click to select an image (jpg, png, webp · max 5 MB)
              <input type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && pick(e.target.files[0])} />
            </label>
          ) : (
            <div className="relative">
              <img src={preview} alt="preview"
                className="max-h-48 rounded-lg border border-slate-200 mx-auto" />
              <button onClick={clear}
                className="absolute -top-2 -right-2 bg-white border border-slate-300 rounded-full p-1
                           text-slate-500 hover:text-rose-600 shadow">
                <XIcon className="w-3 h-3" />
              </button>
            </div>
          )}
          <input value={caption} onChange={e => setCaption(e.target.value)}
            placeholder="Optional caption (what should Claude pay attention to?)"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={analyze} disabled={busy || !base64}
            className="px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
            Analyze image
          </button>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
          {result && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full border text-xs font-semibold
                                 bg-indigo-50 text-indigo-800 border-indigo-200">
                  {result.intent}
                </span>
                <span className="text-xs text-slate-500">
                  conf {Math.round((result.confidence ?? 0) * 100)}%
                </span>
              </div>
              <div className="text-xs text-slate-600 whitespace-pre-line">
                <b className="text-slate-800">What Gemini saw:</b> {result.description}
              </div>
              {result.image_url && (
                <div className="text-[11px] text-slate-500">
                  Saved to Cloudflare Images:{' '}
                  <a href={result.image_url} target="_blank" rel="noreferrer"
                    className="text-indigo-600 hover:text-indigo-800 underline break-all">
                    {result.image_url}
                  </a>
                </div>
              )}
              {result.reply && (
                <blockquote className="text-xs text-slate-600 bg-slate-50 border-l-2 border-slate-300 pl-2.5 py-1.5">
                  <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] mb-0.5">
                    Bot would reply:
                  </div>
                  {result.reply}
                </blockquote>
              )}
              <ActionPlanCard action={result.action}
                onApply={applyAction} applyState={applyState} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function postCardFromText(text: string): Promise<void> {
  const res = await apiFetch('/api/agent/create-card', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as {error?: string}).error || `HTTP ${res.status}`);
  }
}

function buildCardPrompt(c: { title: string; assignee_name?: string | null; priority?: string; due_date?: string | null }): string {
  const bits = [c.title];
  if (c.assignee_name) bits.push(`for ${c.assignee_name}`);
  if (c.priority && c.priority !== 'medium') bits.push(`(${c.priority} priority)`);
  if (c.due_date) bits.push(`by ${c.due_date}`);
  return bits.join(' ');
}

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
