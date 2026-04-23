import React, { useEffect, useState } from 'react';
import { fetchMe, Me } from './src/auth';
import Login from './src/pages/Login';
import Shell from './src/Shell';

export default function App() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

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
