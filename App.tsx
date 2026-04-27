import React, { useEffect, useState } from 'react';
import { fetchMe, Me } from './src/auth';
import Login from './src/pages/Login';
import PublicBoard from './src/pages/PublicBoard';
import Shell from './src/Shell';

// Routing here is intentionally tiny — single SPA, only one route worth
// special-casing: `/share/:token` opens a board for an unauthenticated
// recipient, so we skip the Login + Shell chrome entirely.
function publicShareToken(): string | null {
  const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9_\-]+)\/?$/);
  return m ? m[1] : null;
}

export default function App() {
  const shareToken = publicShareToken();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (shareToken) return;            // public link — never call /api/me
    fetchMe().then(setMe);
  }, [shareToken]);

  if (shareToken) {
    return <PublicBoard token={shareToken} />;
  }
  if (me === null) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 text-slate-400">
        Loading…
      </div>
    );
  }
  if (!me.authenticated) {
    return <Login onDone={() => fetchMe().then(setMe)} />;
  }
  return <Shell me={me} />;
}
