import { clearSession, loadSession } from './auth';

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

let onUnauthorized: () => void = () => {};

// The app registers this to return to the login screen.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// The one function that talks to the backend. Never retries: a request that
// "failed" on the network may still have been executed by Apps Script.
export async function call<T>(action: string, payload?: object): Promise<T> {
  const url = import.meta.env.VITE_API_URL;
  if (!url) throw new ApiError('NETWORK', 'VITE_API_URL is not set');

  let json: { ok: boolean; data?: T; error?: { code?: ErrorCode; message?: string } };
  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer. No other headers.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: loadSession()?.token, payload }),
    });
    json = await res.json();
  } catch {
    throw new ApiError('NETWORK', 'No usable response from server');
  }

  if (json.ok) return json.data as T;

  const err = new ApiError(json.error?.code ?? 'SERVER_ERROR', json.error?.message ?? '');
  if (err.code === 'UNAUTHORIZED' && action !== 'login') {
    clearSession();
    onUnauthorized();
  }
  throw err;
}
