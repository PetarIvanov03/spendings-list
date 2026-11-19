import { IS_DEMO } from './config';

// localStorage can throw (private mode, blocked site data), so every access is guarded.
// The demo has its own prefix: it shares the origin with the real app (same GitHub Pages
// domain) and must never read or clear the real app's session, caches or unsent expenses.
const PREFIX = IS_DEMO ? 'spend-demo:' : 'spend:';

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* storage unavailable: the app still works, just without memory */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

// Keys (without the app prefix) that start with `prefix`.
export function storeKeys(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX + prefix)) out.push(key.slice(PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}
