import React, { useCallback, useEffect, useState } from 'react';
import {
  Mail, Plus, X, Send, Bot, Loader2, ArrowLeft, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { apiFetch, apiGet, Me } from '../auth';

interface Ticket {
  id: string; subject: string;
  requester_name: string; requester_email: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  assignee_email: string | null;
  source: string; language: 'en' | 'zh';
  created_at: string; updated_at: string;
  message_count?: number;
  last_message_at?: string | null;
}

interface Message {
  id: string; ticket_id: string;
  author_email: string;
  author_kind: 'staff' | 'requester' | 'ai_draft' | 'system';
  body: string; created_at: string;
}

type StatusFilter = 'all' | 'open' | 'pending' | 'resolved' | 'closed';

// Support page: left rail = ticket list (status-filtered) + "New
// ticket" button. Right pane = active ticket thread + reply box +
// "Draft AI reply" button. Mirrors a standard helpdesk shape.
export default function Support({ me }: { me: Me }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canReply = me.role === 'boss' || me.role === 'pa';

  const load = useCallback(async () => {
    try {
      const url = filter === 'all'
        ? '/api/support/tickets'
        : `/api/support/tickets?status=${filter}`;
      const d = await apiGet<{ tickets: Ticket[] }>(url);
      setTickets(d.tickets);
    } catch (e) { setErr(String(e)); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex h-full bg-slate-50">
      <aside className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-indigo-500" />
            <h1 className="text-base font-semibold text-slate-800">Support</h1>
          </div>
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded">
            <Plus className="w-3 h-3" /> New
          </button>
        </header>
        <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1">
          {(['open','pending','resolved','closed','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setFilter(s); setActiveId(null); }}
              className={`text-[11px] px-2 py-0.5 rounded ${
                filter === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 && (
            <p className="p-6 text-center text-xs text-slate-400">No tickets in this view.</p>
          )}
          {tickets.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50
                ${t.id === activeId ? 'bg-indigo-50/50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{t.subject}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {t.requester_name} · {new Date(t.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <StatusPill status={t.status} />
              </div>
              {t.message_count != null && (
                <div className="text-[10px] text-slate-400 mt-1">{t.message_count} msg</div>
              )}
            </button>
          ))}
        </div>
        {err && <p className="p-3 text-xs text-rose-700">{err}</p>}
      </aside>

      <main className="flex-1 overflow-hidden">
        {activeId ? (
          <TicketThread me={me} ticketId={activeId}
            canReply={canReply}
            onChanged={load}
            onClose={() => setActiveId(null)} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-slate-400">
            Pick a ticket on the left, or create a new one.
          </div>
        )}
      </main>

      {creating && (
        <NewTicketModal me={me}
          onDone={() => { setCreating(false); load(); }}
          onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Ticket['status'] }) {
  const cls = {
    open:     'bg-amber-100 text-amber-800',
    pending:  'bg-sky-100 text-sky-800',
    resolved: 'bg-emerald-100 text-emerald-800',
    closed:   'bg-slate-100 text-slate-500',
  }[status];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${cls}`}>
      {status}
    </span>
  );
}

function TicketThread({ me, ticketId, canReply, onChanged, onClose }: {
  me: Me;
  ticketId: string;
  canReply: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ ticket: Ticket; messages: Message[] }>(
        `/api/support/tickets/${ticketId}`
      );
      setTicket(d.ticket);
      setMessages(d.messages);
    } catch (e) { setErr(String(e)); }
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  async function postReply() {
    if (!reply.trim() || !canReply) return;
    setPosting(true); setErr(null);
    try {
      const r = await apiFetch(`/api/support/tickets/${ticketId}/messages`, {
        method: 'POST', body: JSON.stringify({ body: reply.trim() }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      setReply('');
      load();
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setPosting(false); }
  }

  async function draftAi() {
    setDrafting(true); setErr(null);
    try {
      const r = await apiFetch(`/api/support/tickets/${ticketId}/draft`, { method: 'POST' });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      const body = await r.json();
      setReply(body.draft || '');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setDrafting(false); }
  }

  async function setStatus(status: Ticket['status']) {
    await apiFetch(`/api/support/tickets/${ticketId}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
    load();
    onChanged();
  }

  if (!ticket) return <div className="p-10 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3">
        <button onClick={onClose} className="md:hidden text-slate-500">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-800 truncate">{ticket.subject}</h2>
          <p className="text-xs text-slate-500">
            {ticket.requester_name} · <span className="font-mono">{ticket.requester_email}</span>
            {ticket.assignee_email && <> · assignee {ticket.assignee_email.split('@')[0]}</>}
          </p>
        </div>
        <StatusPill status={ticket.status} />
        {canReply && (
          <select value={ticket.status} onChange={e => setStatus(e.target.value as Ticket['status'])}
            className="text-xs border border-slate-200 rounded px-2 py-1">
            <option value="open">open</option>
            <option value="pending">pending</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
          </select>
        )}
      </header>
      <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-4 space-y-3">
        {messages.map(m => <MessageBubble key={m.id} m={m} />)}
        {messages.length === 0 && (
          <p className="text-sm text-slate-400 italic">No messages yet.</p>
        )}
      </div>
      {canReply && (
        <div className="border-t border-slate-200 bg-white p-4 space-y-2">
          {err && <p className="text-xs text-rose-700">{err}</p>}
          <textarea value={reply} onChange={e => setReply(e.target.value)}
            placeholder="Type a reply…"
            rows={4}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <button onClick={draftAi} disabled={drafting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
              {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
              {drafting ? 'Drafting…' : 'Draft with AI'}
            </button>
            <button onClick={postReply} disabled={!reply.trim() || posting}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded-lg">
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const isStaff = m.author_kind === 'staff';
  const isAi = m.author_kind === 'ai_draft';
  const align = isStaff || isAi ? 'ml-auto' : '';
  const bg = isStaff ? 'bg-indigo-600 text-white border-indigo-600'
    : isAi ? 'bg-violet-50 text-violet-900 border-violet-200'
    : 'bg-white text-slate-800 border-slate-200';
  const author = m.author_kind === 'requester' ? m.author_email
    : m.author_kind === 'staff' ? `${m.author_email.split('@')[0]} (staff)`
    : m.author_kind === 'ai_draft' ? `AI draft for ${m.author_email.split('@')[0]}`
    : 'system';
  return (
    <div className={`max-w-[80%] border rounded-lg p-3 text-sm ${bg} ${align}`}>
      <div className="text-[10px] opacity-80 mb-1 flex items-center gap-1.5">
        {isAi && <Bot className="w-3 h-3" />}
        <span>{author}</span>
        <span>· {new Date(m.created_at).toLocaleString()}</span>
        {isAi && <span className="ml-1 italic">draft only — not sent</span>}
      </div>
      <div className="whitespace-pre-wrap break-words">{m.body}</div>
    </div>
  );
}

function NewTicketModal({ me, onDone, onClose }: {
  me: Me; onDone: () => void; onClose: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [requesterName, setRequesterName] = useState(me.email.split('@')[0]);
  const [requesterEmail, setRequesterEmail] = useState(me.email);
  const [language, setLanguage] = useState<'en'|'zh'>('en');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          requester_name: requesterName.trim(),
          requester_email: requesterEmail.trim(),
          language,
        }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold">New support ticket</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </header>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Your name</span>
              <input value={requesterName} onChange={e => setRequesterName(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Your email</span>
              <input type="email" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500">Subject</span>
            <input required value={subject} onChange={e => setSubject(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Describe the issue</span>
            <textarea required value={body} onChange={e => setBody(e.target.value)}
              rows={6}
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Reply language</span>
            <select value={language} onChange={e => setLanguage(e.target.value as 'en'|'zh')}
              className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
          {err && <p className="text-xs text-rose-700">{err}</p>}
        </div>
        <footer className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
          <button type="submit" disabled={!subject.trim() || !body.trim() || busy}
            className="px-3 py-1.5 text-sm bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded-lg">
            {busy ? 'Filing…' : 'File ticket'}
          </button>
        </footer>
      </form>
    </div>
  );
}
