import { useCallback, useEffect, useRef, useState } from 'react';
import { getCached, setCached } from './cache';
import { errorText } from './messages';

interface State<T> {
  data: T | null;
  error: string;
  pending: boolean; // a request is in flight
}

export interface CacheOption {
  name: string; // cache slot
  match: string; // which month / filter this data is for
}

// Data younger than this is shown without asking the server again.
const FRESH_MS = 15_000;

// Loads data on mount and whenever deps change (stale-while-revalidate when `cache` is given:
// the cached copy is shown at once and refreshed in the background).
// - loading: nothing to show yet. refreshing: showing data while a request is in flight.
// - A failed refresh keeps the old data on screen and sets `error`.
// - refetch() always asks the server.
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], cache?: CacheOption) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const seq = useRef(0);

  const [state, setState] = useState<State<T>>(() => {
    const hit = cache ? getCached<T>(cache.name, cache.match) : null;
    return { data: hit ? hit.data : null, error: '', pending: !hit };
  });

  const load = useCallback((force: boolean) => {
    const id = ++seq.current;
    const opt = cacheRef.current;
    const hit = opt ? getCached<T>(opt.name, opt.match) : null;

    if (!force && hit) {
      if (Date.now() - hit.at < FRESH_MS) {
        setState({ data: hit.data, error: '', pending: false });
        return;
      }
      setState({ data: hit.data, error: '', pending: true });
    } else {
      setState((s) => ({ data: force ? s.data : null, error: '', pending: true }));
    }

    fetcherRef.current().then(
      (data) => {
        if (id !== seq.current) return;
        if (opt) setCached(opt.name, opt.match, data);
        setState({ data, error: '', pending: false });
      },
      (e) => {
        if (id === seq.current) setState((s) => ({ data: s.data, error: errorText(e), pending: false }));
      },
    );
  }, []);

  useEffect(() => {
    load(false);
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(() => load(true), [load]);
  return {
    data: state.data,
    error: state.error,
    loading: state.pending && state.data === null,
    refreshing: state.pending && state.data !== null,
    refetch,
  };
}
