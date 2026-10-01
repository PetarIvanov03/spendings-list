import { store } from './storage';

export type Role = 'admin' | 'member';

export interface Session {
  token: string;
  expiresAt: number; // unix seconds
  user: { name: string; role: Role };
}

const KEY = 'session';

// Returns the stored session, or null if missing, corrupt or expired.
export function loadSession(): Session | null {
  const raw = store.get(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (s.token && s.expiresAt > Date.now() / 1000) return s;
  } catch {
    /* fall through to cleanup */
  }
  store.remove(KEY);
  return null;
}

export function saveSession(session: Session): void {
  store.set(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  store.remove(KEY);
}

// Admin PINs are 6 digits, member PINs 4.
export function pinLength(role: Role): number {
  return role === 'admin' ? 6 : 4;
}
