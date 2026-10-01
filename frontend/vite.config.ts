import { defineConfig } from 'vite';

// base = repo name, because GitHub Pages serves the site under /spendings-list/.
export default defineConfig({
  base: '/spendings-list/',
  // Changes on every build; the service worker is registered as sw.js?v=<id> so each
  // release installs a fresh worker and cache.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});
