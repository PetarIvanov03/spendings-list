import { store } from './storage';

// An expense the user has saved on the Add screen but the server has not confirmed yet.
// `rid` is the expense's client_id (uuid, generated once). Every send of the same item uses
// it, so the database never records it twice (unique constraint), however many retries.
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
