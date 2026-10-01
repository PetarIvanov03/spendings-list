import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './messages';

interface State<T> {
  data: T | null;
  error: string;
  loading: boolean;
}

// Loads data on mount and whenever deps change. Ignores responses from superseded requests.
// refetch() keeps the old data on screen while loading; a dep change clears it.
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: null, error: '', loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const load = useCallback((keep: boolean) => {
    const id = ++seq.current;
    setState((s) => ({ data: keep ? s.data : null, error: '', loading: true }));
    fetcherRef.current().then(
      (data) => {
        if (id === seq.current) setState({ data, error: '', loading: false });
      },
      (e) => {
        if (id === seq.current) setState({ data: null, error: errorText(e), loading: false });
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
  return { ...state, refetch };
}
