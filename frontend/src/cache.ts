// Stale-while-revalidate cache: screens show the last data at once and refresh in the
// background. Kept in memory and in localStorage, scoped by user name, and cleared on
// logout and on UNAUTHORIZED. Holds server data only, never PINs or tokens.
import { loadSession } from './auth';
import { store, storeKeys } from './storage';

interface Entry {
  at: number; // when the data was fetched (ms since epoch)
  match: string; // which month / filter the data is for
  data: unknown;
}

const memory = new Map<string, Entry>();
const PREFIX = 'cache:';

const keyFor = (name: string) => `${PREFIX}${loadSession()?.user.name ?? ''}:${name}`;

function readEntry(key: string): Entry | undefined {
  let entry = memory.get(key);
  if (!entry) {
    const raw = store.get(key);
    if (raw) {
      try {
        entry = JSON.parse(raw) as Entry;
        memory.set(key, entry);
      } catch {
        store.remove(key);
      }
    }
  }
  return entry;
}

export function getCached<T>(name: string, match: string): { data: T; at: number } | null {
  const entry = readEntry(keyFor(name));
  return entry && entry.match === match ? { data: entry.data as T, at: entry.at } : null;
}

export function setCached(name: string, match: string, data: unknown): void {
  const entry: Entry = { at: Date.now(), match, data };
  const key = keyFor(name);
  memory.set(key, entry);
  store.set(key, JSON.stringify(entry));
}

export function dropCached(name: string): void {
  const key = keyFor(name);
  memory.delete(key);
  store.remove(key);
}

// Keeps the data (it is still shown at once) but forces the next view to refresh it.
export function markStale(name: string): void {
  const key = keyFor(name);
  const entry = readEntry(key);
  if (!entry) return;
  entry.at = 0;
  store.set(key, JSON.stringify(entry));
}

// After any write: lists, summaries and the admin people list may be out of date.
export function invalidateDataCaches(): void {
  markStale('list');
  markStale('summary');
  markStale('adminUsers');
  markStale('templates');
}

export function clearAllCached(): void {
  memory.clear();
  storeKeys(PREFIX).forEach((key) => store.remove(key));
}
