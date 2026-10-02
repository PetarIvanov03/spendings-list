import { useSyncExternalStore } from 'react';
import { clearSession } from './auth';
import { recordCall } from './debug';
import { backendSend } from './supabase';

// Server codes plus two client-side ones: NETWORK (no usable response: offline, blocked,
// non-JSON) and TIMEOUT (no response within 30 s; the request may still have executed).
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'LOCKED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'TIMEOUT';

export class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const TIMEOUT_MS = 30_000;
// Never retried automatically. addExpense IS retried: its client_id makes a repeat harmless.
const NO_RETRY = new Set(['login', 'changePin']);
const MUTATING = new Set([
  'addExpense', 'updateExpense', 'deleteExpense', 'changePin',
  'addCategory', 'updateCategory', 'renameCategory', 'restoreExpense', 'purgeExpense',
]);
const WRITE_RETRY_DELAYS = [2000, 4000, 8000];
const READ_RETRY_DELAYS = [1500, 3000];

let onUnauthorized: () => void = () => {};

// The app registers this to return to the login screen.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// The client_id of a new expense: generated once, reused by every send of that expense.
export function newClientId(): string {
  return crypto.randomUUID();
}

// ---- "retrying" indicator: how many calls are currently waiting to retry ----

let retrying = 0;
const listeners = new Set<() => void>();
function setRetrying(delta: number): void {
  retrying += delta;
  listeners.forEach((l) => l());
}
export function useRetrying(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => retrying > 0,
  );
}

// One attempt. Anything that is not an ApiError counts as a transport failure.
async function attempt<T>(action: string, payload: object | undefined): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('TIMEOUT', 'No response within 30 s')), TIMEOUT_MS);
  });
  try {
    const data = (await Promise.race([backendSend(action, payload), timeout])) as T;
    recordCall({ action, total: Math.round(performance.now() - started), result: 'ok' });
    return data;
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError('NETWORK', 'No usable response from server');
    recordCall({ action, total: Math.round(performance.now() - started), result: err.code });
    if (err.code === 'UNAUTHORIZED' && action !== 'login') {
      clearSession();
      onUnauthorized();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface CallOptions {
  onRetry?: (retryNumber: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The one function that talks to the backend.
// - Writes (all idempotent) retry up to 3 times after a network error or
//   timeout (2 s, 4 s, 8 s), and so does addExpense (same client_id). changePin and login never.
// - Reads retry up to 2 times, only when there was no usable response.
export async function call<T>(action: string, payload?: object, options: CallOptions = {}): Promise<T> {
  const mutating = MUTATING.has(action);
  const delays = NO_RETRY.has(action) ? [] : mutating ? WRITE_RETRY_DELAYS : READ_RETRY_DELAYS;

  let marked = false;
  try {
    for (let n = 0; ; n++) {
      try {
        return await attempt<T>(action, payload);
      } catch (e) {
        const retryable = e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT');
        if (!retryable || n >= delays.length) throw e;
        if (!marked) {
          marked = true;
          setRetrying(1);
        }
        options.onRetry?.(n + 1);
        await sleep(delays[n]);
      }
    }
  } finally {
    if (marked) setRetrying(-1);
  }
}
