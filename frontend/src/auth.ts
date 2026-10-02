import { store } from './storage';

export type Role = 'admin' | 'member';

// Mirror of who is logged in, for the UI. The real session (tokens, refresh) is kept by
// supabase-js; an expired one shows up as UNAUTHORIZED on the next request.
export interface Session {
  user: { name: string; role: Role };
}

const KEY = 'session';

// Returns the stored session, or null if missing or corrupt.
export function loadSession(): Session | null {
  const raw = store.get(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (s.user?.name && s.user.role) return { user: s.user };
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

// Every PIN is exactly 6 digits.
export function pinLength(_role: Role): number {
  return 6;
}
