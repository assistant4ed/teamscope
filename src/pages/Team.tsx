import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, X, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, apiFetch, Me } from '../auth';

interface Subscriber {
  id: string; telegram_chat_id: number; name: string;
  role: string | null; timezone: string;
  language: 'zh' | 'en';
  template_set_id?: string;
  slot_morning: string; slot_midday: string; slot_eod: string;
  working_days: number[]; active: boolean; created_at: string;
  updated_at?: string;
}
interface RecentReport {
  report_date: string;
  goals: string | null;
  mid_progress: string | null; mid_issues: string | null;
  eod_completed: string | null; eod_unfinished: string | null;
  eod_hours: number | null;
  updated_at: string;
}
interface Profile {
  id: string; telegram_chat_id: number | null; name: string;
  role: string; timezone: string; active: boolean;
}

export default function Team({ me, onOpenMember }: {
  me: Me;
  onOpenMember: (subscriberId: string) => void;
}) {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roster, setRoster] = useState<{email:string;role:string}[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    const d = await apiGet<{ subscribers: Subscriber[]; profiles: Profile[] }>('/api/team');
    setSubs(d.subscribers);
    setProfiles(d.profiles);
    const r = await fetch('/api/config/roster').then(r => r.json());
    setRoster(r.users || []);
  }
  useEffect(() => { load(); }, []);

  const toggle = async (id: string) => {
    await apiPost(`/api/team/subscribers/${id}/toggle`);
    load();
  };

  const dayLabels = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Team</h1>
      <p className="text-sm text-slate-500 mb-6">Subscribers for daily reports + web-app users.</p>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
            Daily-report subscribers
          </h2>
          {me.role === 'boss' && (
            <button onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium
                         bg-indigo-50 text-indigo-700 hover:bg-indigo-100
                         px-3 py-1.5 rounded-lg">
              <UserPlus className="w-3.5 h-3.5" /> Add subscriber
            </button>
          )}
        </div>
        {showAdd && <AddSubscriberModal onDone={() => { setShowAdd(false); load(); }}
                                         onClose={() => setShowAdd(false)} />}
        {editId && me.role === 'boss' && (
          <EditSubscriberModal
            id={editId}
            onDone={() => { setEditId(null); load(); }}
            onClose={() => setEditId(null)}
          />
        )}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <Th>Name</Th><Th>Role</Th><Th>TZ</Th>
                <Th>Slots</Th><Th>Days</Th><Th>Status</Th>
                {me.role === 'boss' && <Th></Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subs.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">
                  No subscribers yet. Telegram /joinreport to enroll.
                </td></tr>
              )}
              {subs.map(s => (
                <tr key={s.id}
                    className={`${s.active ? '' : 'opacity-40'} cursor-pointer hover:bg-slate-50`}
                    onClick={() => onOpenMember(s.id)}>
                  <Td className="font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      {s.name}
                      <span className="text-xs text-slate-400 font-mono">@{s.telegram_chat_id}</span>
                    </div>
                  </Td>
                  <Td>{s.role || '—'}</Td>
                  <Td>{s.timezone}</Td>
                  <Td className="text-xs">
                    {s.slot_morning.slice(0,5)} · {s.slot_midday.slice(0,5)} · {s.slot_eod.slice(0,5)}
                  </Td>
                  <Td className="text-xs">
                    {s.working_days.map(d => dayLabels[d]).join(' ')}
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>{s.active ? 'active' : 'paused'}</span>
                  </Td>
                  {me.role === 'boss' && (
                    <Td>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); toggle(s.id); }}
                          className="text-xs text-slate-500 hover:text-slate-800">
                          {s.active ? 'Pause' : 'Resume'}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditId(s.id); }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-0.5 rounded"
                          title="Edit details">
                          <Edit2 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Web-app roster (ALLOWED_USERS)
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          {roster.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">
              No whitelisted users — set <code>ALLOWED_USERS</code> on Railway.
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {roster.map(u => (
              <li key={u.email} className="py-2 flex items-center justify-between">
                <span className="font-mono text-sm text-slate-700">{u.email}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  u.role === 'boss' ? 'bg-indigo-50 text-indigo-700' :
                  u.role === 'pa'   ? 'bg-emerald-50 text-emerald-700' :
                  'bg-slate-50 text-slate-700'
                }`}>{u.role}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-slate-400">
            Add more via <code>ALLOWED_USERS=email:role,email:role</code> on Railway → redeploy.
          </div>
        </div>
      </section>

      <TemplateSetsSection isBoss={me.role === 'boss'} />

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Telegram profiles ({profiles.length})
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <ul className="divide-y divide-slate-100">
            {profiles.map(p => (
              <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-slate-800">{p.name} <span className="text-slate-400 text-xs">@{p.telegram_chat_id}</span></span>
                <span className="text-xs text-slate-500">{p.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <PublicHolidaysSection isBoss={me.role === 'boss'} />

      {me.role === 'boss' && <EmailAdminSection />}
      {me.role === 'boss' && <SupportKbSection />}
    </div>
  );
}

// ---------- Support KB (boss-managed AI grounding facts) ----------- //
interface KbEntry {
  id: string; title: string; body: string;
  is_active: boolean; position: number; updated_at: string;
}

function SupportKbSection() {
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; body: string }>({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ entries: KbEntry[] }>('/api/support/kb');
      setEntries(d.entries);
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/support/kb', {
        method: 'POST', body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setNewTitle(''); setNewBody(''); setCreating(false);
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggle(entry: KbEntry) {
    await apiFetch(`/api/support/kb/${entry.id}`, {
      method: 'PATCH', body: JSON.stringify({ is_active: !entry.is_active }),
    });
    load();
  }

  async function saveEdit(id: string) {
    if (!editDraft.title.trim() || !editDraft.body.trim()) return;
    await apiFetch(`/api/support/kb/${id}`, {
      method: 'PATCH', body: JSON.stringify(editDraft),
    });
    setEditId(null);
    load();
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this KB entry?')) return;
    await apiFetch(`/api/support/kb/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Support knowledge base
      </h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-3">
          Facts the AI draft-reply on the Support page grounds answers in.
          Active entries are concatenated and appended to Claude's system prompt
          so money / policy / fee answers don't get invented.
        </p>
        {creating ? (
          <form onSubmit={create} className="border border-slate-200 rounded-lg p-3 mb-4 space-y-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Title (e.g. Refund policy)"
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)}
              placeholder="The fact, in 2-4 sentences. Be precise about numbers and conditions."
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)}
                className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
              <button type="submit" disabled={!newTitle.trim() || !newBody.trim() || busy}
                className="px-3 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded-lg">
                {busy ? 'Saving…' : 'Add entry'}
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setCreating(true)}
            className="mb-4 inline-flex items-center gap-1 text-xs px-2 py-1 text-slate-500 border border-dashed border-slate-300 rounded hover:border-slate-400 hover:text-slate-700">
            + New entry
          </button>
        )}
        {entries.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No KB entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map(en => (
              <li key={en.id} className="py-3">
                {editId === en.id ? (
                  <div className="space-y-2">
                    <input value={editDraft.title} onChange={e => setEditDraft({ ...editDraft, title: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium" />
                    <textarea value={editDraft.body} onChange={e => setEditDraft({ ...editDraft, body: e.target.value })}
                      rows={6}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setEditId(null)}
                        className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
                      <button onClick={() => saveEdit(en.id)}
                        className="px-3 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-white rounded">
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`text-sm font-medium ${en.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                          {en.title}
                        </h4>
                        {!en.is_active && <span className="text-[10px] text-slate-400">disabled</span>}
                      </div>
                      <p className="text-xs text-slate-600 whitespace-pre-wrap">{en.body}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => toggle(en)}
                        className="text-[11px] text-slate-500 hover:text-slate-800">
                        {en.is_active ? 'disable' : 'enable'}
                      </button>
                      <button onClick={() => { setEditId(en.id); setEditDraft({ title: en.title, body: en.body }); }}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800">edit</button>
                      <button onClick={() => remove(en.id)}
                        className="text-[11px] text-rose-600 hover:underline">delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {err && <p className="text-xs text-rose-700 mt-2">{err}</p>}
      </div>
    </section>
  );
}

// ---------- Admin: email templates + logs --------------------------- //
// Boss-facing window into the email subsystem. Lists every event from
// the catalog + the current resolved template (DB override or in-code
// default) with inline editing. Below the events panel sits a recent
// log table — sort by created_at DESC, status badge for failures.
interface EmailEventDef {
  id: string;
  audience: string;
  when_fired: string;
  required_context: string[];
  defaults: Record<'en' | 'zh', { subject: string; body: string }>;
}
interface EmailOverrideRow {
  event_id: string; language: 'en' | 'zh';
  subject: string; body: string;
  updated_at: string; updated_by: string | null;
}
interface EmailLogRow {
  id: string; event_id: string; recipient_email: string;
  subject: string | null; language: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  provider: string | null; provider_id: string | null;
  error: string | null; actor_email: string | null;
  created_at: string; sent_at: string | null;
}

function EmailAdminSection() {
  const [events, setEvents] = useState<EmailEventDef[]>([]);
  const [overrides, setOverrides] = useState<EmailOverrideRow[]>([]);
  const [logs, setLogs] = useState<EmailLogRow[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [activeLang, setActiveLang] = useState<'en' | 'zh'>('en');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [evs, ovs, lgs] = await Promise.all([
        apiGet<{ events: EmailEventDef[] }>('/api/admin/email-events'),
        apiGet<{ overrides: EmailOverrideRow[] }>('/api/admin/email-templates'),
        apiGet<{ logs: EmailLogRow[] }>('/api/admin/email-logs?limit=20'),
      ]);
      setEvents(evs.events);
      setOverrides(ovs.overrides);
      setLogs(lgs.logs);
      if (!activeId && evs.events.length > 0) setActiveId(evs.events[0].id);
    } catch (e) { setErr(String(e)); }
  }, [activeId]);
  useEffect(() => { load(); }, [load]);

  const activeEvent = events.find(e => e.id === activeId);
  const activeOverride = overrides.find(o => o.event_id === activeId && o.language === activeLang);
  const effectiveSubject = activeOverride?.subject ?? activeEvent?.defaults[activeLang]?.subject ?? '';
  const effectiveBody = activeOverride?.body ?? activeEvent?.defaults[activeLang]?.body ?? '';

  // Re-prime the textareas when the active event/lang changes.
  useEffect(() => {
    setDraftSubject(effectiveSubject);
    setDraftBody(effectiveBody);
  }, [activeId, activeLang, activeOverride?.subject, activeOverride?.body, effectiveSubject, effectiveBody]);

  const isOverridden = !!activeOverride;
  const isDirty = draftSubject !== effectiveSubject || draftBody !== effectiveBody;

  async function saveOverride() {
    if (!activeId || !draftSubject.trim() || !draftBody.trim()) return;
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch(
        `/api/admin/email-templates/${encodeURIComponent(activeId)}/${activeLang}`,
        { method: 'PATCH', body: JSON.stringify({ subject: draftSubject, body: draftBody }) }
      );
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  async function resetToDefault() {
    if (!activeId) return;
    if (!window.confirm(`Reset ${activeId} (${activeLang}) to the in-code default?`)) return;
    try {
      await apiFetch(
        `/api/admin/email-templates/${encodeURIComponent(activeId)}/${activeLang}`,
        { method: 'DELETE' }
      );
      load();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Email & notifications
      </h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-5">
        <p className="text-xs text-slate-400">
          Transactional emails sent via Resend. In-code defaults work without any DB rows;
          editing here writes an override per (event, language). Use{' '}
          <code className="px-1 bg-slate-100 rounded text-[11px]">{'{key}'}</code> placeholders —
          required keys are listed under each event.
        </p>

        <div className="grid md:grid-cols-[200px_1fr] gap-4">
          <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
            {events.map(e => {
              const overridden = overrides.some(o => o.event_id === e.id);
              return (
                <button key={e.id} onClick={() => setActiveId(e.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs ${
                    e.id === activeId ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <div className="font-mono">{e.id}</div>
                  <div className="text-[10px] opacity-70">
                    {e.audience}{overridden ? ' · custom' : ''}
                  </div>
                </button>
              );
            })}
          </div>
          {activeEvent && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">{activeEvent.when_fired}</p>
                <p className="text-[11px] text-slate-400">
                  Required keys: {activeEvent.required_context.map(k => (
                    <code key={k} className="mr-1 px-1 bg-slate-100 rounded text-[10px]">{`{${k}}`}</code>
                  ))}
                </p>
              </div>
              <div className="inline-flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => setActiveLang('en')}
                  className={`px-3 py-1 text-xs rounded ${activeLang==='en'?'bg-slate-900 text-white':'text-slate-600'}`}>
                  English
                </button>
                <button onClick={() => setActiveLang('zh')}
                  className={`px-3 py-1 text-xs rounded ${activeLang==='zh'?'bg-slate-900 text-white':'text-slate-600'}`}>
                  中文
                </button>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Subject</label>
                <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Body</label>
                <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)}
                  rows={10}
                  className="w-full font-mono text-xs border border-slate-200 rounded-lg p-2" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveOverride} disabled={!isDirty || saving}
                  className="px-3 py-1.5 text-sm bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded-lg">
                  {saving ? 'Saving…' : isOverridden ? 'Update override' : 'Override default'}
                </button>
                {isOverridden && (
                  <button onClick={resetToDefault}
                    className="text-xs text-rose-600 hover:underline">
                    Reset to default
                  </button>
                )}
                {isOverridden && (
                  <span className="text-[10px] text-slate-400 ml-auto">
                    edited {activeOverride?.updated_at ? new Date(activeOverride.updated_at).toLocaleString() : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Recent activity
          </h3>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-400">No emails sent yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="px-2 py-1 font-medium">When</th>
                    <th className="px-2 py-1 font-medium">Event</th>
                    <th className="px-2 py-1 font-medium">To</th>
                    <th className="px-2 py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td className="px-2 py-1 text-slate-500 tabular-nums">
                        {new Date(l.created_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1 font-mono text-slate-700">{l.event_id}</td>
                      <td className="px-2 py-1 text-slate-600">{l.recipient_email}</td>
                      <td className="px-2 py-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          l.status === 'sent' ? 'bg-emerald-100 text-emerald-800' :
                          l.status === 'failed' ? 'bg-rose-100 text-rose-800' :
                          l.status === 'skipped' ? 'bg-slate-100 text-slate-600' :
                          'bg-amber-100 text-amber-800'
                        }`}>{l.status}</span>
                        {l.error && (
                          <span className="ml-2 text-[10px] text-rose-600" title={l.error}>
                            {l.error.slice(0, 40)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {err && <p className="text-xs text-rose-700">{err}</p>}
      </div>
    </section>
  );
}

// ---------- Question sets (per-role report prompts) ----------------- //
// Surfaces ops.report_template_sets + ops.report_prompt_templates_v2.
// Each set has its own morning / midday / eod prompt in zh and en;
// boss can edit the text inline. {name} placeholder substitutes the
// member's name at send time. Members are assigned to a set via the
// Edit subscriber modal above.
interface TemplateSet {
  id: string;
  name: string;
  description: string | null;
  templates: Record<string, Record<string, { text: string; updated_at: string; updated_by: string | null }>>;
}

function TemplateSetsSection({ isBoss }: { isBoss: boolean }) {
  const [sets, setSets] = useState<TemplateSet[]>([]);
  const [activeId, setActiveId] = useState<string>('default');
  const [activeLang, setActiveLang] = useState<'en' | 'zh'>('en');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ sets: TemplateSet[] }>('/api/config/template-sets');
      setSets(d.sets);
      // Reset drafts to server text whenever we (re)load.
      const next: Record<string, string> = {};
      for (const s of d.sets) {
        for (const slot of ['morning','midday','eod']) {
          for (const lang of ['en','zh']) {
            next[`${s.id}::${slot}::${lang}`] = s.templates[slot]?.[lang]?.text ?? '';
          }
        }
      }
      setDrafts(next);
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveOne(setId: string, slot: string, lang: string) {
    const key = `${setId}::${slot}::${lang}`;
    const text = drafts[key]?.trim();
    if (!text) return;
    setSavingKey(key); setErr(null);
    try {
      const r = await apiFetch(
        `/api/config/template-sets/${encodeURIComponent(setId)}/templates/${slot}/${lang}`,
        { method: 'PATCH', body: JSON.stringify({ template_text: text }) }
      );
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingKey(null); }
  }

  async function createSet(e: React.FormEvent) {
    e.preventDefault();
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!id || !newName.trim()) return;
    setErr(null);
    try {
      const r = await apiFetch('/api/config/template-sets', {
        method: 'POST', body: JSON.stringify({ id, name: newName.trim() }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      setNewId(''); setNewName(''); setCreating(false);
      await load();
      setActiveId(id);
    } catch (e) { setErr((e as Error).message); }
  }

  async function deleteSet(id: string) {
    if (id === 'default') return;
    if (!window.confirm(`Delete the "${id}" question set? Members on this set will fall back to default.`)) return;
    try {
      await apiFetch(`/api/config/template-sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setActiveId('default');
      await load();
    } catch (e) { setErr((e as Error).message); }
  }

  const active = sets.find(s => s.id === activeId);

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Question sets
      </h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-3">
          Each set is its own morning / midday / EOD prompt in zh + en.
          Members are assigned to a set in the Edit subscriber dialog above.
          Use <code className="px-1 bg-slate-100 rounded">{'{name}'}</code> as the placeholder for the member's name.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {sets.map(s => (
            <button key={s.id} onClick={() => setActiveId(s.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                s.id === activeId
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
              {s.name}
            </button>
          ))}
          {isBoss && (
            <button onClick={() => setCreating(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700">
              + New set
            </button>
          )}
        </div>
        {creating && (
          <form onSubmit={createSet} className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">ID (lowercase, no spaces)</label>
              <input value={newId} onChange={e => setNewId(e.target.value)}
                placeholder="marketing"
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[11px] text-slate-500 mb-0.5">Display name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Marketing"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <button type="submit"
              className="px-3 py-1.5 text-sm bg-slate-900 hover:bg-slate-800 text-white rounded-lg">
              Create
            </button>
            <button type="button" onClick={() => setCreating(false)}
              className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">
              Cancel
            </button>
          </form>
        )}
        {active && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="inline-flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => setActiveLang('en')}
                  className={`px-3 py-1 text-xs rounded ${activeLang==='en'?'bg-slate-900 text-white':'text-slate-600'}`}>
                  English
                </button>
                <button onClick={() => setActiveLang('zh')}
                  className={`px-3 py-1 text-xs rounded ${activeLang==='zh'?'bg-slate-900 text-white':'text-slate-600'}`}>
                  中文
                </button>
              </div>
              {isBoss && active.id !== 'default' && (
                <button onClick={() => deleteSet(active.id)}
                  className="text-xs text-rose-600 hover:underline">
                  Delete this set
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(['morning','midday','eod'] as const).map(slot => {
                const key = `${active.id}::${slot}::${activeLang}`;
                const orig = active.templates[slot]?.[activeLang]?.text ?? '';
                const dirty = (drafts[key] ?? '') !== orig;
                return (
                  <div key={slot} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {slot === 'eod' ? 'End of day' : slot}
                      </div>
                      {isBoss && (
                        <button onClick={() => saveOne(active.id, slot, activeLang)}
                          disabled={!dirty || savingKey === key}
                          className="text-xs px-2 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded">
                          {savingKey === key ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                        </button>
                      )}
                    </div>
                    <textarea value={drafts[key] ?? ''}
                      onChange={e => setDrafts({ ...drafts, [key]: e.target.value })}
                      rows={6} disabled={!isBoss}
                      className="w-full font-mono text-xs border border-slate-200 rounded-lg p-2 bg-white
                                 disabled:bg-slate-50 disabled:text-slate-500" />
                  </div>
                );
              })}
            </div>
          </>
        )}
        {err && <p className="text-xs text-rose-700 mt-3">{err}</p>}
      </div>
    </section>
  );
}

// ---------- Public holidays admin (boss-managed) ------------------- //
// Fronts the existing GET/POST/DELETE /api/config/public-holidays
// endpoints. Salary calc on the Member page reads these as non-working
// days; without this UI the boss had to run psql by hand.
interface Holiday { holiday_date: string; name: string; country: string | null }

function PublicHolidaysSection({ isBoss }: { isBoss: boolean }) {
  const [items, setItems] = useState<Holiday[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('HK');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ holidays: Holiday[] }>('/api/config/public-holidays');
      setItems(r.holidays);
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/config/public-holidays', {
        method: 'POST',
        body: JSON.stringify({ holiday_date: date, name: name.trim(), country: country || null }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      setDate(''); setName('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(d: string) {
    if (!window.confirm(`Remove holiday ${d}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/config/public-holidays/${d}`, { method: 'DELETE' });
      load();
    } finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Public holidays
      </h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-3">
          Days flagged as paid-but-not-working in the salary calculator.
          Members aren't expected to file reports on these dates.
        </p>
        {isBoss && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Date</label>
              <input type="date" required value={date} onChange={e => setDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[11px] text-slate-500 mb-0.5">Name</label>
              <input required value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Lunar New Year"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div className="w-20">
              <label className="block text-[11px] text-slate-500 mb-0.5">Country</label>
              <input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 3))}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm uppercase" />
            </div>
            <button type="submit" disabled={busy || !date || !name.trim()}
              className="px-3 py-1.5 text-sm bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg">
              Add
            </button>
          </form>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-slate-400">No holidays added yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map(h => (
              <li key={h.holiday_date} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <span className="font-mono text-slate-500 text-xs mr-3">{h.holiday_date}</span>
                  <span className="text-slate-800">{h.name}</span>
                  {h.country && <span className="ml-2 text-xs text-slate-400 uppercase">{h.country}</span>}
                </div>
                {isBoss && (
                  <button onClick={() => remove(h.holiday_date)} disabled={busy}
                    className="text-xs text-rose-600 hover:underline">Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {err && <p className="text-xs text-rose-700 mt-2">{err}</p>}
      </div>
    </section>
  );
}

interface PromptTemplate {
  text: string;
  updated_at: string;
  updated_by: string | null;
}
type PromptSlot = 'morning' | 'midday' | 'eod';
const PROMPT_SLOTS: Array<{ slot: PromptSlot; label: string; time: string }> = [
  { slot: 'morning', label: 'Morning',    time: '09:00 SGT' },
  { slot: 'midday',  label: 'Midday',     time: '13:30 SGT' },
  { slot: 'eod',     label: 'End of day', time: '18:30 SGT' },
];

function PromptTemplatesSection({ isBoss }: { isBoss: boolean }) {
  const [templates, setTemplates] = useState<Record<string, PromptTemplate> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const d = await apiGet<{ templates: Record<string, PromptTemplate> }>(
        '/api/config/prompt-templates'
      );
      setTemplates(d.templates);
      setErr(null);
    } catch (e) { setErr(String(e)); }
  }
  useEffect(() => { load(); }, []);

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Report prompt templates
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        What <code className="px-1 bg-slate-100 rounded">@edpapabot</code> DMs each subscriber at their slot times.
        {' '}n8n's <i>03 · Report Prompter</i> flow reads these — edit here, no redeploy.
      </p>
      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3">{err}</div>}
      {!templates ? (
        <div className="text-sm text-slate-400 py-4">Loading…</div>
      ) : (
        <div className="space-y-3">
          {PROMPT_SLOTS.map(s => (
            <PromptTemplateRow key={s.slot}
              slot={s.slot} label={s.label} time={s.time}
              template={templates[s.slot]}
              isBoss={isBoss}
              onSaved={() => load()} />
          ))}
        </div>
      )}
    </section>
  );
}

function PromptTemplateRow({ slot, label, time, template, isBoss, onSaved }: {
  slot: PromptSlot; label: string; time: string;
  template: PromptTemplate | undefined;
  isBoss: boolean;
  onSaved: () => void;
}) {
  const [text, setText] = useState(template?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Keep local state in sync if templates reload from the server.
  useEffect(() => { setText(template?.text ?? ''); }, [template?.text]);

  const dirty = text !== (template?.text ?? '');

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/config/prompt-templates/${slot}`, {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-semibold text-slate-800">{label}</span>
          <span className="text-xs text-slate-400 ml-2">{time}</span>
        </div>
        {template?.updated_at && (
          <span className="text-[11px] text-slate-400">
            updated {new Date(template.updated_at).toLocaleString(undefined,
              { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {template.updated_by && <> by {template.updated_by.split('@')[0]}</>}
          </span>
        )}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        readOnly={!isBoss} rows={6}
        className={`w-full border rounded-lg px-3 py-2 text-sm font-mono leading-relaxed
                    ${isBoss ? 'border-slate-200 focus:border-indigo-300'
                             : 'border-slate-100 bg-slate-50 text-slate-500'}`} />
      {isBoss && (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={save} disabled={!dirty || busy}
            className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {justSaved && <span className="text-xs text-emerald-600">✓ Saved</span>}
          {err && <span className="text-xs text-rose-600">{err}</span>}
          {dirty && !busy && !justSaved && (
            <span className="text-xs text-amber-600">Unsaved</span>
          )}
        </div>
      )}
    </div>
  );
}

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="text-left font-medium px-4 py-2">{children}</th>
);
const Td = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <td className={`px-4 py-2 ${className}`}>{children}</td>
);

function AddSubscriberModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [role, setRole] = useState('colleague');
  const [tz, setTz] = useState('Asia/Singapore');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await apiPost('/api/team/subscribers', {
        name, telegram_chat_id: Number(chatId), role, timezone: tz,
      });
      onDone();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit}
        className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add daily-report subscriber</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-500">
          They'll receive Telegram DMs at 09:00 · 13:30 · 18:30 (SGT) asking
          for morning goals / mid-day progress / end-of-day summary.
        </p>
        <Field label="Name">
          <input required value={name} onChange={e => setName(e.target.value)}
            placeholder="Meghan Ang"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </Field>
        <Field label="Telegram chat ID"
          hint="Ask them to DM @userinfobot → copy the numeric id it replies with.">
          <input required value={chatId} onChange={e => setChatId(e.target.value)}
            placeholder="5246139725"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="colleague">Colleague</option>
              <option value="pa">PA</option>
              <option value="designer">Designer</option>
              <option value="dev">Developer</option>
              <option value="sales">Sales</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select value={tz} onChange={e => setTz(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option>Asia/Singapore</option>
              <option>Asia/Kuala_Lumpur</option>
              <option>Asia/Hong_Kong</option>
              <option>Asia/Taipei</option>
              <option>Asia/Shanghai</option>
              <option>Asia/Tokyo</option>
              <option>UTC</option>
            </select>
          </Field>
        </div>
        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                       disabled:opacity-40 text-white rounded-lg">
            {busy ? 'Adding…' : 'Add subscriber'}
          </button>
        </div>
      </form>
    </div>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-700">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
  </label>
);

// Postgres `time` renders as "HH:MM:SS"; <input type="time"> expects "HH:MM".
const toHHMM = (v: string | undefined) => (v ?? '').slice(0, 5);
const toHHMMSS = (v: string) => (v.length === 5 ? `${v}:00` : v);

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const TZ_OPTIONS = [
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Hong_Kong',
  'Asia/Taipei', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Los_Angeles', 'UTC',
];
const ROLE_OPTIONS = ['colleague', 'pa', 'designer', 'dev', 'sales', 'manager'];

function EditSubscriberModal({ id, onDone, onClose }: {
  id: string; onDone: () => void; onClose: () => void;
}) {
  const [sub, setSub] = useState<Subscriber | null>(null);
  const [reports, setReports] = useState<RecentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Controlled fields
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [role, setRole] = useState('');
  const [tz, setTz] = useState('Asia/Singapore');
  const [slotMorning, setSlotMorning] = useState('09:00');
  const [slotMidday, setSlotMidday] = useState('13:30');
  const [slotEod, setSlotEod] = useState('18:30');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [active, setActive] = useState(true);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [templateSetId, setTemplateSetId] = useState<string>('default');
  const [templateSets, setTemplateSets] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    apiGet<{ sets: Array<{ id: string; name: string }> }>('/api/config/template-sets')
      .then(d => setTemplateSets(d.sets))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiGet<{ subscriber: Subscriber; recent_reports: RecentReport[] }>(
          `/api/team/subscribers/${id}`
        );
        if (cancelled) return;
        setSub(d.subscriber);
        setReports(d.recent_reports);
        setName(d.subscriber.name);
        setChatId(String(d.subscriber.telegram_chat_id));
        setRole(d.subscriber.role ?? 'colleague');
        setTz(d.subscriber.timezone);
        setSlotMorning(toHHMM(d.subscriber.slot_morning));
        setSlotMidday(toHHMM(d.subscriber.slot_midday));
        setSlotEod(toHHMM(d.subscriber.slot_eod));
        setDays(d.subscriber.working_days ?? []);
        setActive(d.subscriber.active);
        setLanguage(d.subscriber.language ?? 'zh');
        setTemplateSetId(d.subscriber.template_set_id ?? 'default');
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          telegram_chat_id: Number(chatId),
          role,
          timezone: tz,
          slot_morning: toHHMMSS(slotMorning),
          slot_midday: toHHMMSS(slotMidday),
          slot_eod: toHHMMSS(slotEod),
          working_days: days,
          active,
          language,
          template_set_id: templateSetId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/team/subscribers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={save}
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Edit subscriber</h3>
            {sub && (
              <p className="text-xs text-slate-400 mt-0.5">
                ID <span className="font-mono">{sub.id.slice(0, 8)}</span>
                {sub.updated_at && <> · updated {new Date(sub.updated_at).toLocaleString()}</>}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-0 overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <input required value={name} onChange={e => setName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </Field>
                <Field label="Telegram chat ID">
                  <input required value={chatId} onChange={e => setChatId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Role">
                  <select value={role} onChange={e => setRole(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    {ROLE_OPTIONS.map(r =>
                      <option key={r} value={r}>{r}</option>
                    )}
                  </select>
                </Field>
                <Field label="Timezone">
                  <select value={tz} onChange={e => setTz(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    {TZ_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Daily-report slots" hint="Times are in the subscriber's own timezone.">
                <div className="grid grid-cols-3 gap-3">
                  <SlotInput label="Morning" value={slotMorning} onChange={setSlotMorning} />
                  <SlotInput label="Midday" value={slotMidday} onChange={setSlotMidday} />
                  <SlotInput label="End of day" value={slotEod} onChange={setSlotEod} />
                </div>
              </Field>

              <Field label="Bot language" hint="Telegram DMs go out in this language. Replies are auto-translated to English when stored.">
                <div className="flex gap-2">
                  {(['zh', 'en'] as const).map(lng => {
                    const on = language === lng;
                    return (
                      <button key={lng} type="button" onClick={() => setLanguage(lng)}
                        className={`flex-1 text-sm py-2 rounded-lg border transition
                          ${on
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                        {lng === 'zh' ? '中文' : 'English'}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Question set" hint="Which morning / midday / EOD prompt the bot sends. Manage sets below.">
                <select value={templateSetId} onChange={e => setTemplateSetId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  {templateSets.length === 0 && <option value="default">Default</option>}
                  {templateSets.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Working days">
                <div className="flex gap-1.5">
                  {ALL_DAYS.map(d => {
                    const on = days.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => toggleDay(d)}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition
                          ${on
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                        {DAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <label className="flex items-center gap-2 pt-2">
                <input type="checkbox" checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="rounded border-slate-300" />
                <span className="text-sm text-slate-700">
                  Active (receives daily-report DMs)
                </span>
              </label>

              {err && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
                  {err}
                </div>
              )}
            </div>

            <aside className="bg-slate-50 border-l border-slate-100 p-5">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Recent reports
              </h4>
              {reports.length === 0 ? (
                <p className="text-xs text-slate-400">No reports filed yet.</p>
              ) : (
                <ul className="space-y-3">
                  {reports.map(r => (
                    <li key={r.report_date} className="text-xs">
                      <div className="font-medium text-slate-700">
                        {new Date(r.report_date).toLocaleDateString(undefined,
                          { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      <div className="text-slate-500 mt-0.5 space-y-0.5">
                        {r.goals && <div><b>Goals:</b> {truncate(r.goals, 80)}</div>}
                        {r.eod_completed && <div><b>Done:</b> {truncate(r.eod_completed, 80)}</div>}
                        {r.eod_hours != null && <div><b>Hours:</b> {r.eod_hours}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4" />
              Delete <b>{name}</b>? This cannot be undone.
              <button type="button" onClick={remove} disabled={busy}
                className="ml-2 px-3 py-1 text-xs font-medium bg-rose-600 hover:bg-rose-700
                           disabled:opacity-40 text-white rounded-lg">
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-lg">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}
              disabled={loading || busy}
              className="inline-flex items-center gap-1.5 text-xs text-rose-600
                         hover:text-rose-700 disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" /> Delete subscriber
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            <button type="submit" disabled={loading || busy}
              className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800
                         disabled:opacity-40 text-white rounded-lg">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

const SlotInput = ({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) => (
  <label className="block">
    <span className="text-[11px] text-slate-500">{label}</span>
    <input type="time" value={value} onChange={e => onChange(e.target.value)}
      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
  </label>
);

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
