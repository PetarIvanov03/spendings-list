# spendings-list

A small phone-first web app for a family to log daily expenses.

**Stack:** React + TypeScript + Vite (static site on GitHub Pages) and Supabase (Postgres, Auth, Row Level Security). The browser talks to Supabase directly with the public (publishable) key; access rules live in the database. No server code of our own.

## Run locally

```
cd frontend
npm ci
npm run dev
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `frontend/src/config.ts` (the publishable key is safe to commit; never use a secret / service_role key).

## Checks

```
npm run typecheck
npm run build
```

Deployment: pushing to `main` builds `frontend` and publishes `frontend/dist` to GitHub Pages (`.github/workflows/deploy.yml`). Details for contributors and Claude Code are in `CLAUDE.md`.
