// Optional API diagnostics, enabled with localStorage "debug" = "1".
// Logs one line per call and keeps the last calls in window.__apiTimings.
// Never records PINs, tokens or payloads.

export interface CallRecord {
  label: string; // user action / screen load the call belongs to
  n: number; // call number within that label
  action: string;
  total: number; // round trip, ms
  result: string; // "ok" or the error code
  at: number;
}

declare global {
  interface Window {
    __apiTimings?: CallRecord[];
  }
}

let label = 'start';
let count = 0;

function debugEnabled(): boolean {
  try {
    return localStorage.getItem('debug') === '1';
  } catch {
    return false;
  }
}

// Starts a new group: the call counter restarts so we can see calls per screen or action.
export function markAction(next: string): void {
  label = next;
  count = 0;
}

export function recordCall(r: Omit<CallRecord, 'label' | 'n' | 'at'>): void {
  count++;
  if (!debugEnabled()) return;
  const rec: CallRecord = { ...r, label, n: count, at: Date.now() };
  const table = (window.__apiTimings ??= []);
  table.push(rec);
  if (table.length > 200) table.shift();
  console.log(`[api] ${r.action} ${r.result} total=${r.total}ms (#${count} in "${label}")`);
}
