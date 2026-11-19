import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { runBootstrap } from './bootstrap';
import { IS_DEMO } from './config';
import { isIdleExpired } from './idle';
import './styles.css';

// With a stored session, the one start-up request goes out before React renders.
if (!isIdleExpired()) runBootstrap(); // an expired session is closed by the idle watcher instead

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: production only. When a new build takes over, reload once so nobody
// stays on an old version (skipped on the very first visit, when there is nothing to replace).
// The demo (base /spendings-list/demo/) registers the app's sw.js one level up with its own,
// narrower scope: a separate installable app with a separate cache (see sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL;
  const script = IS_DEMO ? base.replace(/demo\/$/, '') : base;
  const hadController = navigator.serviceWorker.controller !== null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${script}sw.js?v=${__BUILD_ID__}`, { scope: base }).catch(() => {});
  });
}
