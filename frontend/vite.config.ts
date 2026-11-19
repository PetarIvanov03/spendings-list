import { defineConfig, type Plugin } from 'vite';

const REAL_URL = 'https://petarivanov03.github.io/spendings-list/';

// Demo page (`npm run build:demo`, served at /spendings-list/demo/): not installable, so the
// manifest that opens the real app goes; title and link preview say "демо".
function demoHtml(): Plugin {
  return {
    name: 'demo-html',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/, '')
        .replace('<title>Разходи</title>', '<title>Разходи – демо</title>')
        .replace(/("og:title" content=")Разходи/, '$1Разходи – демо')
        .replace(`content="${REAL_URL}"`, `content="${REAL_URL}demo/"`);
    },
  };
}

// base = repo name, because GitHub Pages serves the site under /spendings-list/.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/spendings-list/demo/' : '/spendings-list/',
  // Demo: the same app with src/supabase.ts replaced by src/demo/backend.ts (made-up data in
  // memory, no network). Only src/api.ts and src/App.tsx import './supabase'.
  resolve: mode === 'demo' ? { alias: [{ find: /^\.\/supabase$/, replacement: '/src/demo/backend.ts' }] } : {},
  plugins: mode === 'demo' ? [demoHtml()] : [],
  // Changes on every build; the service worker is registered as sw.js?v=<id> so each
  // release installs a fresh worker and cache.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
}));
