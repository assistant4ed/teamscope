import React, { useEffect, useState } from 'react';
import Board, { ApiCtx } from './Board';
import type { Me } from '../auth';

interface PublicMeta {
  board: { id: string; name: string; share_mode: 'view' | 'edit' };
}

// Standalone landing page for `/share/:token`. Skips Login + Shell so a
// recipient can open the link without an account. Once we know whether
// the token is valid and which mode it grants, we render the same Board
// component with a public ApiCtx — the rendering tree is identical to
// the authed view, just routed through /api/public/board/:token/* under
// the hood.
export default function PublicBoard({ token }: { token: string }) {
  const [meta, setMeta] = useState<PublicMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/board/${encodeURIComponent(token)}`);
        if (res.status === 404) {
          setErr('This share link is invalid or has been revoked.');
          return;
        }
        if (!res.ok) {
          setErr(`Failed to load (${res.status}).`);
          return;
        }
        const body = await res.json();
        setMeta({ board: body.board });
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [token]);

  if (err) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Share link unavailable</h1>
          <p className="text-sm text-slate-500">{err}</p>
        </div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 text-slate-400">
        Loading shared board…
      </div>
    );
  }

  // Synthesize a Me for Board's role checks. The actual capability gates
  // live in Board (which respects apiCtx.kind first), so this is mostly
  // cosmetic — but role='boss' lets the rendering treat the visitor as
  // capable of seeing all controls a public-edit user is allowed.
  const fakeMe: Me = {
    authenticated: true,
    email: 'share-link@public',
    role: 'boss',
  };

  const apiCtx: ApiCtx = meta.board.share_mode === 'edit'
    ? { kind: 'public-edit', token }
    : { kind: 'public-view', token };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1600px] mx-auto h-screen flex flex-col">
        <Board me={fakeMe} apiCtx={apiCtx} />
      </div>
    </div>
  );
}
