import { store } from './storage';

// An expense the user has saved on the Add screen but the server has not confirmed yet.
// It keeps its requestId for its whole life: every send of the same item uses the same id,
// so the server never records it twice (it replays its stored response for 30 minutes).
export interface PendingExpense {
  rid: string;
  date: string;
  item: string;
  price: number;
  category: string;
  createdAt: number; // ms since epoch
  status: 'sending' | 'failed' | 'saved';
  attempt: number; // automatic retry in progress (0 = first try)
  error?: string;
}

// The server remembers a requestId for 30 minutes. Older items may be sent again by the
// user, but only after a warning, because a double entry can no longer be ruled out.
export const REPLAY_WINDOW_MS = 25 * 60 * 1000;

const keyFor = (user: string) => `pending:${user}`;

// Items found after a reload were interrupted: show them as failed, never auto-send them.
export function loadPending(user: string): PendingExpense[] {
  const raw = store.get(keyFor(user));
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as PendingExpense[])
      .filter((p) => p && typeof p.rid === 'string' && typeof p.price === 'number')
      .map((p) => ({ ...p, status: 'failed' as const, attempt: 0, error: 'Прекъснато. „Опитай пак“ няма да го запише два пъти.' }));
  } catch {
    return [];
  }
}

export function savePending(user: string, list: PendingExpense[]): void {
  const unsent = list.filter((p) => p.status !== 'saved');
  if (unsent.length > 0) store.set(keyFor(user), JSON.stringify(unsent));
  else store.remove(keyFor(user));
}
