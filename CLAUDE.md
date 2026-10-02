# Family Expenses Tracker

A tiny, phone-first web app for a family of 4 to log daily expenses. Replaces a hand-kept Google Sheet.
Priorities: **dead simple daily use** (add an expense in ~3 taps), low maintenance, free hosting.

## Architecture

- **Frontend**: static site on **GitHub Pages**. Vite + React + TypeScript, plain CSS (no UI kit). No router library: tab state in React state. Vite `base`: `/spendings-list/`.
- **Backend**: **Supabase** (Postgres + Auth + Row Level Security). The browser talks to it directly with `@supabase/supabase-js` and the **publishable** key. There is no server code of our own: security is RLS.
- **Legacy**: the old Google Apps Script backend was removed from the tree. It is available at the git tag `pre-supabase`.
- The repo is **public**. Never commit a secret / `service_role` key, PINs or data exports. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` live in `frontend/src/config.ts` (both safe to publish).

## Database (Supabase; schema already exists, do not change it without asking)

- `profiles(id = auth.uid(), name, is_admin)`
- `categories(id bigint, name, active, sort_order)` (no color column: the frontend picks a color per category id)
- `expenses(id bigint, user_id default auth.uid(), category_id, amount numeric, spent_on date, description, deleted_at, created_at, client_id uuid not null default gen_random_uuid() unique)`
- `templates(id bigint, user_id default auth.uid(), title, category_id, amount numeric null, sort_order, created_at)`: personal; RLS gives each user (admin too) only their own
- view `monthly_totals(user_id, category_id, month date, total, n)`: only non-deleted rows, RLS applies
- function `delete_expense(p_id bigint)`: soft delete (sets `deleted_at`)

RLS: members see and change only their own expenses; the admin reads all and manages categories and the trash. Anything else is refused by the database, so hiding admin UI from members is only cosmetic.

## Auth

- Login = typed name + **6-digit PIN** (same length for everyone). The name is normalized (trim, collapse spaces, NFC, lower case) and turned into the email `<name>@spendings.app`; then `supabase.auth.signInWithPassword({ email, password: pin })`. supabase-js stores and refreshes the session.
- Wrong name and wrong PIN give the same error ("Грешно име или ПИН").
- `changePin`: first `signInWithPassword` with the old PIN (wrong → `FORBIDDEN`), then `auth.updateUser({ password })`, then the app returns to login.
- Creating users, setting someone else's PIN and activating/deactivating users need the secret key, so they are NOT possible from the browser. Do those in the Supabase dashboard. The "people" screen (`AdminUsers.tsx`) exists but is not shown.
- `localStorage` `session` only mirrors `{name, role}` for the UI (token field is a placeholder); the real session is supabase-js's.

## Idle logout (`idle.ts`)

After `IDLE_TIMEOUT_MS` (config.ts, 10 min) without pointerdown/keydown/touchstart/scroll the app logs out. `lastActivityAt` is a localStorage timestamp (throttled to 5 s), so it works across reloads and tabs. The elapsed time is checked, not timed: at start, on `visibilitychange`, on `focus` and every 30 s. Logout = `signOut({ scope: 'local' })` (this device only), clears cached server data, waits up to 10 s for a request in flight, and the login screen shows a one-time notice. Unsent expenses stay in their per-user queue and are sent only from that user's Add screen (`addExpense` also refuses a queued item when a different user is logged in).

## Data access (`frontend/src/supabase.ts`)

`call(action, payload)` in `api.ts` is the only function screens use. It dispatches to `backendSend` in `supabase.ts`, which maps the old action names to Supabase queries and returns names (not ids) and string expense ids, so screens did not change. Errors become `ApiError` with codes `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `SERVER_ERROR`, `NETWORK`, `TIMEOUT`.

- **Every list query filters `deleted_at is null`** (the admin's RLS would otherwise show the trash). Month filters use `spent_on >= first-of-month and < first-of-next-month`; order `spent_on desc, created_at desc`.
- **Summaries** read `monthly_totals` for `month = YYYY-MM-01` and sum in JS (total, by category, by user, by user x category).
- **Delete** = `rpc('delete_expense')` (soft). **Trash** (admin): `deleted_at is not null`, newest deleted first; restore sets `deleted_at = null`; permanent delete is a real `delete`, only on rows already in the trash.
- **Categories** (admin): list all, add (`sort_order = max + 1`, name 1-50 chars, unique, conflict shows "Вече съществува"), rename (expenses follow through `category_id`), activate/deactivate, reorder (renumber 1..n). No delete. Inactive categories disappear from the Add menu; old expenses keep them.
- **No retries without safety**: `login` and `changePin` are never retried; other writes are idempotent and retry after network errors or a 30 s timeout (2 s, 4 s, 8 s); reads retry twice.

### Personal templates (`Templates.tsx`)

Chips above the Add form fill description, category and amount (empty amount = empty, focused field); saving is a normal `addExpense` and never changes the template. A template whose category is inactive is dimmed and warns "Категорията е изключена" without filling the category. The "Шаблони" button opens the manager (add, edit, delete with confirm, reorder with arrows). The expense edit sheet has "Запази като шаблон".

### Duplicate protection (`client_id`)

When a new expense is first saved on the Add screen, `crypto.randomUUID()` is generated ONCE and stored in the pending item (`pending.ts`, field `rid`, persisted in localStorage per user, so it survives a reload). Every send of that item (automatic retry, "Опитай пак", resend when the network returns, resend after reload) uses the SAME `client_id`. `addExpense` inserts it; a `23505` on `expenses_client_id_key` means "already saved": the existing row is fetched by `client_id` and returned as success. `client_id` is internal to adding and never appears in lists or summaries. It does not expire.

## Frontend

- **Target viewport: 360 CSS px wide**, mobile-first, tap targets >= 44px, bottom tab bar. UI language **Bulgarian**; code, comments and identifiers in English. Currency EUR via `Intl.NumberFormat('bg-BG', ...)`.
- Screens: Login, Add (price, item, date, category chips; instant save into a "pending" strip that sends in the background), List (month, edit, delete), Summary (month, total, per-category bars; admin: family or one person), Admin tab (admin only): **Категории** and **Кошче**. Own-PIN change in the menu.
- **Design system** (visual only): tokens at the top of `styles.css` (light/dark via `prefers-color-scheme`), system fonts, inline SVG icons, no icon library, no CSS framework. `npm run contrast` checks WCAG AA for every token pair and category chip color; run it after changing a color. Skeleton loading states, `prefers-reduced-motion` respected.
- **Stale-while-revalidate** (`cache.ts`, `useFetch.ts`): categories, the current month's list and last viewed list/summary are cached in memory and localStorage, scoped by user name, cleared on logout and `UNAUTHORIZED`. After a write the caches are marked stale, not dropped. PINs are never cached.
- **PWA**: `manifest.webmanifest`, minimal `sw.js` that caches only the static app shell, never cross-origin or non-GET requests (so never Supabase calls); registered only in production as `sw.js?v=<build id>`.
- Layout (`frontend/src`): `api.ts`, `supabase.ts`, `config.ts`, `auth.ts`, `storage.ts`, `messages.ts`, `write.ts`, `bootstrap.ts`, `App.tsx`, `Shell.tsx`, screens (`Login`, `AddScreen`, `ListScreen` + `ExpenseSheet`, `SummaryScreen`, `AdminScreen` -> `AdminCategories`, `AdminTrash`), shared (`components.tsx`, `icons.tsx`, `PinPad.tsx`, `useFetch.ts`, `categories.ts`, `online.tsx`, `toast.tsx`, `format.ts`, `types.ts`).
- Dependencies stay minimal: React, Vite, TypeScript, `@supabase/supabase-js` (exact version). Ask before adding more.

## Deployment

GitHub Actions builds `frontend` and deploys to GitHub Pages on push to `main`. Supabase URL and publishable key are in `config.ts` (no secrets, no repository variables needed).

## Checks

`npm run typecheck && npm run build` from `frontend/`. Manual checks need real accounts: log in as a member and as the admin, add/edit/delete, trash restore and purge, offline add then reconnect (exactly one row), and try `supabase.from('categories').update(...)` as a member (RLS must change nothing).

## Rules for Claude Code

Keep the code small and readable, no speculative features, no extra dependencies without asking, ask before changing the database schema, and never put a secret key in the repo.
