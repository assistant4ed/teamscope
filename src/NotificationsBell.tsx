import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { apiFetch, apiGet } from './auth';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

// Sidebar bell with unread count + dropdown panel. Polls every 60s
// for new items so the boss sees mention pings without a refresh.
// Click opens the panel; clicking a row marks-read and follows link.
export default function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ notifications: Notification[]; unread: number }>(
        '/api/notifications'
      );
      setItems(d.notifications || []);
      setUnread(d.unread || 0);
    } catch { /* silent — bell shouldn't break the app */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [open]);

  async function markOne(id: string, link: string | null) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    if (link) window.location.href = link;
    else load();
  }

  async function markAll() {
    await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
    load();
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 relative">
        <Bell className="w-5 h-5" />
        Notifications
        {unread > 0 && (
          <span className="ml-auto text-[10px] bg-rose-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-medium">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 left-2 right-2 bottom-full mb-2 bg-white rounded-lg shadow-lg border border-slate-200 max-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-700">Notifications</span>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAll} className="text-[11px] text-indigo-600 hover:underline">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)}>
                <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700" />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">All caught up.</p>
            )}
            {items.map(n => {
              const isUnread = n.read_at === null;
              return (
                <button key={n.id} onClick={() => markOne(n.id, n.link_url)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50
                    ${isUnread ? 'bg-indigo-50/40' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0
                      ${isUnread ? 'bg-indigo-500' : 'bg-transparent'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-800 truncate">{n.title}</div>
                      {n.body && (
                        <div className="text-[11px] text-slate-500 truncate">{n.body}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">{relTime(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
