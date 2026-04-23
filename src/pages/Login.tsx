import React, { useState } from 'react';
import { setEmail } from '../auth';

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setLocalEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email.includes('@')) { setErr('Not a valid email.'); return; }
    setEmail(email);
    // Verify server accepts this email before letting them in
    const r = await fetch('/api/me', {
      headers: { 'X-User-Email': email.trim().toLowerCase() },
    }).then(r => r.json()).catch(() => ({ authenticated: false }));
    if (!r.authenticated) {
      setErr('That email isn’t on the team roster. Ask Ed to add it.');
      localStorage.removeItem('teamscope.email');
      return;
    }
    onDone();
  };

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <form onSubmit={submit}
        className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-8 shadow-lg space-y-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-900">TeamScope</div>
          <div className="text-sm text-slate-500 mt-1">DeFiner Ops Console</div>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Your work email</span>
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={e => setLocalEmail(e.target.value)}
            placeholder="you@company.com"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button type="submit"
          className="w-full bg-slate-900 hover:bg-slate-800 text-white
                     font-medium py-2 rounded-lg transition">
          Continue
        </button>
        <p className="text-xs text-slate-400 text-center">
          Access is granted via the ALLOWED_USERS roster. No passwords — the
          server trusts this email only if it’s whitelisted.
        </p>
      </form>
    </div>
  );
}
