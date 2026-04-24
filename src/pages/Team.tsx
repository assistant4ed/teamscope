import React, { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { apiGet, apiPost, Me } from '../auth';

interface Subscriber {
  id: string; telegram_chat_id: number; name: string;
  role: string | null; timezone: string;
  slot_morning: string; slot_midday: string; slot_eod: string;
  working_days: number[]; active: boolean; created_at: string;
}
interface Profile {
  id: string; telegram_chat_id: number | null; name: string;
  role: string; timezone: string; active: boolean;
}

export default function Team({ me }: { me: Me }) {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roster, setRoster] = useState<{email:string;role:string}[]>([]);
  const [showAdd, setShowAdd] = useState(false);

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
                <tr key={s.id} className={s.active ? '' : 'opacity-40'}>
                  <Td className="font-medium text-slate-800">{s.name}</Td>
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
                      <button onClick={() => toggle(s.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800">
                        {s.active ? 'Pause' : 'Resume'}
                      </button>
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
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4">
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
