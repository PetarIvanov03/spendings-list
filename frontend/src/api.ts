import { clearSession, loadSession } from './auth';
import { debugEnabled, recordCall, type Timing } from './debug';

// Server codes plus NETWORK (no usable response: offline, blocked, non-JSON).
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'LOCKED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'NETWORK';

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

let onUnauthorized: () => void = () => {};

// The app registers this to return to the login screen.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function transport(action: string, payload: object | undefined): Promise<Envelope> {
  const token = loadSession()?.token;
  const debug = debugEnabled() || undefined; // sent only when diagnostics are on

  // Dev-only mock backend (VITE_MOCK=1 with `npm run dev`). The DEV check lets the
  // bundler drop this branch, and the mock module, from production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
    const { mockSend } = await import('./mockApi');
    return mockSend(action, payload, token, debug);
  }

  const url = import.meta.env.VITE_API_URL;
  if (!url) throw new ApiError('NETWORK', 'VITE_API_URL is not set');
  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer. No other headers.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload, debug }),
    });
    return (await res.json()) as Envelope;
  } catch {
    throw new ApiError('NETWORK', 'No usable response from server');
  }
}

// The one function that talks to the backend. Never retries: a request that
// "failed" on the network may still have been executed by Apps Script.
export async function call<T>(action: string, payload?: object): Promise<T> {
  const started = performance.now();
  let res: Envelope;
  try {
    res = await transport(action, payload);
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
