import { useSyncExternalStore } from 'react';
import { clearSession, loadSession } from './auth';
import { debugEnabled, recordCall, type Timing } from './debug';

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

export type Envelope = ({ ok: true; data: unknown } | { ok: false; error: { code?: ErrorCode; message?: string } }) & {
  ms?: number; // server execution time
  timing?: Timing; // only when the request had debug: true
};

const TIMEOUT_MS = 30_000;
// Mutating actions: the server replays the stored response for a repeated requestId,
// so retrying them with the SAME requestId is safe.
const MUTATING = new Set([
  'addExpense', 'updateExpense', 'deleteExpense', 'changePin', 'addCategory', 'updateCategory',
  'renameCategory', 'addUser', 'setUserActive', 'setPin',
]);
const WRITE_RETRY_DELAYS = [2000, 4000, 8000]; // 3 retries after the first attempt
const READ_RETRY_DELAYS = [1500, 3000]; // 2 retries, network failures only

let onUnauthorized: () => void = () => {};

// The app registers this to return to the login screen.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
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

async function transport(action: string, payload: object | undefined, requestId: string | undefined): Promise<Envelope> {
  const token = loadSession()?.token;
  const debug = debugEnabled() || undefined; // sent only when diagnostics are on

  // Dev-only mock backend (VITE_MOCK=1 with `npm run dev`). The DEV check lets the
  // bundler drop this branch, and the mock module, from production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
    const { mockSend } = await import('./mockApi');
    return mockSend(action, payload, token, debug, requestId);
  }

  const url = import.meta.env.VITE_API_URL;
  if (!url) throw new ApiError('NETWORK', 'VITE_API_URL is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer. No other headers.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload, requestId, debug }),
      signal: controller.signal,
    });
    return (await res.json()) as Envelope;
  } catch {
    throw controller.signal.aborted
      ? new ApiError('TIMEOUT', 'No response within 30 s')
      : new ApiError('NETWORK', 'No usable response from server');
  } finally {
    clearTimeout(timer);
  }
}

// One attempt.
async function attempt<T>(action: string, payload: object | undefined, requestId: string | undefined): Promise<T> {
  const started = performance.now();
  let res: Envelope;
  try {
    res = await transport(action, payload, requestId);
  } catch (e) {
    recordCall({ action, total: Math.round(performance.now() - started), result: e instanceof ApiError ? e.code : 'ERROR' });
    throw e;
  }
  const total = Math.round(performance.now() - started);
  recordCall({
    action,
    total,
    server: res.ms,
    network: res.ms === undefined ? undefined : total - res.ms,
    timing: res.timing,
    result: res.ok ? 'ok' : (res.error?.code ?? 'SERVER_ERROR'),
  });
  if (res.ok) return res.data as T;

  const err = new ApiError(res.error?.code ?? 'SERVER_ERROR', res.error?.message ?? '');
  if (err.code === 'UNAUTHORIZED' && action !== 'login') {
    clearSession();
    onUnauthorized();
  }
  throw err;
}

export interface CallOptions {
  requestId?: string; // reuse the id of an earlier attempt (pending expenses)
  onRetry?: (retryNumber: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The one function that talks to the backend.
// - Mutating actions get a requestId and are retried up to 3 times with the SAME id after a
//   network error, timeout or SERVER_ERROR (2 s, 4 s, 8 s). The server replays the stored
//   response if the first attempt had actually been executed.
// - Reads retry up to 2 times, only when there was no usable response.
// - login is never retried automatically.
export async function call<T>(action: string, payload?: object, options: CallOptions = {}): Promise<T> {
  const mutating = MUTATING.has(action);
  const requestId = mutating ? (options.requestId ?? newRequestId()) : undefined;
  const delays = mutating ? WRITE_RETRY_DELAYS : action === 'login' ? [] : READ_RETRY_DELAYS;

  let marked = false;
  try {
    for (let n = 0; ; n++) {
      try {
        return await attempt<T>(action, payload, requestId);
      } catch (e) {
        const transportFailure = e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT');
        const retryable = transportFailure || (mutating && e instanceof ApiError && e.code === 'SERVER_ERROR');
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
