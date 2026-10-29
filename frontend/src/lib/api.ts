import { useEffect, useState } from 'react';

// Dev: the API runs on :3001 next to the Vite server. Production: same origin, or VITE_API_BASE for the Apache build.
export const API_BASE = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (import.meta.env.VITE_API_BASE || '');

export type Role = 'admin' | 'quizmaster' | 'coordinator' | 'volunteer';
export interface Staff { id: string; username: string; displayName: string; role: Role }
export interface StaffSession { token: string; staff: Staff }

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  quizmaster: 'Quiz master',
  coordinator: 'Coordinator',
  volunteer: 'Volunteer',
};

// Who may conduct the live event from the host console.
export const CAN_HOST: Role[] = ['admin', 'coordinator'];

const KEY = 'techsprint_staff';
const SESSION_EVENT = 'techsprint-session';

// localStorage can throw (private mode); staff then simply sign in again.
export const session = {
  get(): StaffSession | null {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  set(s: StaffSession) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
    window.dispatchEvent(new Event(SESSION_EVENT));
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    window.dispatchEvent(new Event(SESSION_EVENT));
  },
};

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const s = session.get();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server — check the connection', 0, null);
  }
  const data = await res.json().catch(() => ({}));
  // 401 = the sign-in expired or was revoked (a wrong set PIN is 403 and keeps you signed in).
  if (res.status === 401 && s && path !== '/auth/login') session.clear();
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

// Download a file from an authenticated endpoint.
export async function downloadFile(path: string, filename: string) {
  const s = session.get();
  const res = await fetch(`${API_BASE}/api${path}`, { headers: s ? { Authorization: `Bearer ${s.token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Download failed', res.status, data);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Fetch an authenticated file (e.g. a question picture) as an object URL for <img>.
export async function fetchObjectUrl(path: string): Promise<string> {
  const s = session.get();
  const res = await fetch(`${API_BASE}/api${path}`, { headers: s ? { Authorization: `Bearer ${s.token}` } : {} });
  if (!res.ok) throw new ApiError('Could not load the file', res.status, {});
  return URL.createObjectURL(await res.blob());
}

// Current staff session; re-renders on sign-in/out (including from other tabs).
export function useStaffSession() {
  const [current, setCurrent] = useState<StaffSession | null>(session.get);
  useEffect(() => {
    const sync = () => setCurrent(session.get());
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return current;
}

export async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* already gone */ }
  session.clear();
}
