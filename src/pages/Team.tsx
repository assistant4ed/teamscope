import React, { useEffect, useState } from 'react';
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
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Daily-report subscribers
        </h2>
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
