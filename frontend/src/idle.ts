import { IDLE_TIMEOUT_MS } from './config';
import { store } from './storage';

// Automatic logout after inactivity. The last activity is a timestamp in localStorage, so it
// survives a reload and is shared by all tabs. Timers are not trusted (they stall in a
// background tab or on a locked phone): the elapsed time is CHECKED on start, when the tab
// becomes visible, on focus, and every 30 s.

const KEY = 'lastActivityAt';
const THROTTLE_MS = 5000;
const CHECK_EVERY_MS = 30_000;
const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

let lastWritten = 0;

// Records activity now. force: skip the throttle (login, start).
export function markActivity(force = false): void {
  const now = Date.now();
  if (!force && now - lastWritten < THROTTLE_MS) return;
  lastWritten = now;
  store.set(KEY, String(now));
}

export function clearActivity(): void {
  lastWritten = 0;
  store.remove(KEY);
}

export function isIdleExpired(): boolean {
  const last = Number(store.get(KEY));
  return Number.isFinite(last) && last > 0 && Date.now() - last > IDLE_TIMEOUT_MS;
}

// Starts watching; calls onIdle (possibly more than once) when the time is exceeded.
// Returns a function that stops watching.
export function watchIdle(onIdle: () => void): () => void {
  // A session from before this feature (or cleared storage) has no timestamp: start counting now.
  if (!store.get(KEY)) markActivity(true);
  const check = () => {
    if (isIdleExpired()) onIdle();
  };
  const onActivity = () => markActivity();
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  EVENTS.forEach((e) => window.addEventListener(e, onActivity, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', check);
  const timer = window.setInterval(check, CHECK_EVERY_MS);
  check(); // app start: an expired session is closed at once
  return () => {
    EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', check);
    window.clearInterval(timer);
  };
}
