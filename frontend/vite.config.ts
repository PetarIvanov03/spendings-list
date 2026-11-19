import { defineConfig, type Plugin } from 'vite';

const REAL_URL = 'https://petarivanov03.github.io/spendings-list/';

// Demo page (`npm run build:demo`, served at /spendings-list/demo/): its own name, link preview
// and install manifest (src/demo/public: orange "DEMO" icons, scope /spendings-list/demo/), so it
// installs as a separate app and never opens or replaces the real one.
function demoHtml(): Plugin {
  return {
    name: 'demo-html',
    transformIndexHtml(html) {
      return html
        .replace('<title>Разходи</title>', '<title>Разходи – демо</title>')
        .replace(/(name="apple-mobile-web-app-title" content=")Разходи/, '$1Демо Разходи')
        .replace(/("og:title" content=")Разходи/, '$1Разходи – демо')
        .replace(/(name="theme-color" content=")#[0-9a-f]{6}(" media="\(prefers-color-scheme: light\)")/, '$1#d9480f$2')
        .replaceAll(REAL_URL, `${REAL_URL}demo/`); // og:url, og:image
    },
  };
}

// base = repo name, because GitHub Pages serves the site under /spendings-list/.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/spendings-list/demo/' : '/spendings-list/',
  // Demo: the same app with src/supabase.ts replaced by src/demo/backend.ts (made-up data in
  // memory, no network). Only src/api.ts and src/App.tsx import './supabase'.
  resolve: mode === 'demo' ? { alias: [{ find: /^\.\/supabase$/, replacement: '/src/demo/backend.ts' }] } : {},
  // Demo: its own manifest and icons. No sw.js here: the demo registers the real one (one
  // level up) with the demo scope, and sw.js keeps a separate cache per scope.
  publicDir: mode === 'demo' ? 'src/demo/public' : 'public',
  plugins: mode === 'demo' ? [demoHtml()] : [],
  // Changes on every build; the service worker is registered as sw.js?v=<id> so each
  // release installs a fresh worker and cache.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
}));
