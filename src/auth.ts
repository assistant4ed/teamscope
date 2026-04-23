/**
 * Light-weight auth helper: stores the logged-in email in localStorage and
 * attaches it to every fetch via X-User-Email. Server validates against the
 * ALLOWED_USERS whitelist.
 */

const EMAIL_KEY = 'teamscope.email';

export type Role = 'boss' | 'pa' | 'colleague';
export interface Me { authenticated: boolean; email?: string; role?: Role }

export function getEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function setEmail(email: string) {
  localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
}

export function signOut() {
  localStorage.removeItem(EMAIL_KEY);
  window.location.reload();
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const email = getEmail();
  const headers = new Headers(init.headers);
  if (email) headers.set('X-User-Email', email);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchMe(): Promise<Me> {
  try {
    const res = await apiFetch('/api/me');
    return (await res.json()) as Me;
  } catch {
    return { authenticated: false };
  }
}
