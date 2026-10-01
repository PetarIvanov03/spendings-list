import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { runBootstrap } from './bootstrap';
import './styles.css';

// With a stored session, the one start-up request goes out before React renders.
runBootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: production only. When a new build takes over, reload once so nobody
// stays on an old version (skipped on the very first visit, when there is nothing to replace).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL;
  const hadController = navigator.serviceWorker.controller !== null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js?v=${__BUILD_ID__}`, { scope: base }).catch(() => {});
  });
}
