import { useSyncExternalStore } from 'react';

// Same breakpoint as the desktop block at the end of styles.css: keep them in sync.
const DESKTOP = '(min-width: 960px)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

// For the few things CSS alone cannot do on desktop (extra data, both admin sections at once).
export const useDesktop = () => useMediaQuery(DESKTOP);
