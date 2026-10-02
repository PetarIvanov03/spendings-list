import { ApiError } from './api';
import { invalidateDataCaches } from './cache';
import { errorText } from './messages';

export type WriteResult =
  | { ok: true }
  | { ok: false; code: string; message: string; uncertain: boolean };

// Runs one mutating call (call() already retried it where that is safe). `uncertain`
// means that even after the retries we do not know whether the server executed it
// (NETWORK / TIMEOUT / SERVER_ERROR): the caller must refetch so the user sees the truth.
export async function runWrite(fn: () => Promise<unknown>): Promise<WriteResult> {
  try {
    await fn();
    invalidateDataCaches();
    return { ok: true };
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'UNKNOWN';
    const uncertain = code === 'NETWORK' || code === 'TIMEOUT' || code === 'SERVER_ERROR';
    if (uncertain) invalidateDataCaches(); // it may have been executed: do not trust cached lists
    return {
      ok: false,
      code,
      message: errorText(e, true),
      uncertain,
    };
  }
}
