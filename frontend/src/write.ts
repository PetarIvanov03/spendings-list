import { ApiError } from './api';
import { errorText } from './messages';

export type WriteResult =
  | { ok: true }
  | { ok: false; code: string; message: string; uncertain: boolean };

// Runs one mutating call. Never retries. `uncertain` means the server may or may not have
// executed it (NETWORK / SERVER_ERROR): the caller must refetch so the user sees the truth.
export async function runWrite(fn: () => Promise<unknown>): Promise<WriteResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'UNKNOWN';
    return {
      ok: false,
      code,
      message: errorText(e, true),
      uncertain: code === 'NETWORK' || code === 'SERVER_ERROR',
    };
  }
}
