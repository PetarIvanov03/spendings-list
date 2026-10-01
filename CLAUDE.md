# Family Expenses Tracker

A tiny, phone-first web app for a family of 4 to log daily expenses. Replaces a hand-kept Google Sheet.
Priorities: **dead simple daily use** (add an expense in ~3 taps), low maintenance, free hosting.

## Architecture

- **Frontend**: static site on **GitHub Pages**. Vite + React + TypeScript, plain CSS (no UI kit). No router library: tab state in React state (avoids 404s on Pages). Set Vite `base` to the repo name.
- **Backend**: **Google Apps Script** web app, **container-bound** to the Google Sheet, managed locally with **clasp**. The Sheet is the database.
- **Repo layout**
  ```
  /backend     Apps Script source (TypeScript or JS) + appsscript.json + .clasp.json
  /frontend    Vite app
  /CLAUDE.md
  ```
  Vite `base`: `/spendings-list/`
  
- The repo is **public**. Never commit PINs, hashes, HMAC secrets or the spreadsheet contents. The web app URL is not a secret and goes in `frontend/.env` as `VITE_API_URL`.

### appsscript.json
```json
{
  "timeZone": "Europe/Sofia",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "exceptionLogging": "STACKDRIVER"
}
```

## Google Sheet schema (already created, do not restructure)

Spreadsheet time zone is Sofia. The script never reads the `Summary` tab (it is for humans only).

**Expenses** (header row 1, data from row 2):
`id | date | item | price | category | user | createdAt`
- `id`: short unique string (first 8 chars of `Utilities.getUuid()`; old rows may have it empty, so backfill ids lazily or via a one-off function)
- `date`: real Date cell. API format is `YYYY-MM-DD`; convert with `Utilities.formatDate(d, 'Europe/Sofia', 'yyyy-MM-dd')`.
- `price`: number (EUR)
- `category`: category **name as text**
- `user`: user name of who entered it (may be empty for legacy rows)
- `createdAt`: Date (ISO in API)

**Categories**: `name | color | active | order`  (color is a hex like `#d9ead3`)
**Users**: `name | active | role`  (role is `admin` or `member`; exactly one admin)
**PINs are NOT in the Sheet.** They live in Script Properties (see Auth).

## API protocol

One endpoint: the Apps Script web app URL.

- `POST` with header `Content-Type: text/plain;charset=utf-8` and a JSON string body. This avoids a CORS preflight, which Apps Script cannot answer. **Do not add any custom headers** from the frontend.
- Request: `{ "action": "addExpense", "token": "...", "payload": { ... } }`
- Response: always HTTP 200 (Apps Script can't set status codes). Body:
  - success: `{ "ok": true, "data": ... }`
  - failure: `{ "ok": false, "error": { "code": "FORBIDDEN", "message": "..." } }`
- Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `LOCKED`, `NOT_FOUND`, `CONFLICT`, `SERVER_ERROR`.
- `doGet` returns `{ok:true,data:"pong"}` (health check only).
- Test with curl (the `-L` is required, Apps Script redirects):
  ```
  curl -L -X POST -H 'Content-Type: text/plain' -d '{"action":"loginOptions"}' "$API_URL"
  ```
- Frontend has exactly one function `call(action, payload)` in `src/api.ts` that attaches the token, parses the response, throws typed errors, and on `UNAUTHORIZED` clears the token and returns to the login screen.

## Auth

- Login = pick your name from a list + enter PIN. Member PIN: 4 digits. Admin PIN: 6 digits.
- PINs are stored hashed in Script Properties: key `pin:<userName>` = SHA-256(salt + pin) hex, with `PIN_SALT` also in Script Properties.
- **Session token is stateless**: `base64url(JSON{u: name, exp: unixSeconds, v: tokenVersion}) + "." + HMAC-SHA256(payload, TOKEN_SECRET)`. `TOKEN_SECRET` in Script Properties. Lifetime 90 days. `tokenVersion` per user (`tv:<userName>` property) is bumped on `setPin`/`changePin`/user deactivation, which invalidates old tokens.
- Every authenticated request: verify signature and expiry, check `v` matches, then **look up the user and role from the Users sheet on the server**. Never trust role data from the client. Implement `requireUser(token)` and `requireAdmin(token)`.
- **Lockout**: 5 wrong PINs for a user within 15 min → `LOCKED` for 15 min (CacheService counter per user name). Same error message for wrong name/wrong PIN.
- Bootstrap PINs without committing them: add an `onOpen` custom menu in the Sheet ("Expenses admin" → "Set PIN for user…") that uses `SpreadsheetApp.getUi().prompt()` twice (name, PIN). The same hashing function is used by the `setPin` endpoint. Also provide a one-off `initSecrets()` that generates `PIN_SALT` and `TOKEN_SECRET` if missing.

## Endpoints

Legend: **P** public, **U** any logged-in user, **A** admin only.

| Action | Role | Payload | Returns |
|---|---|---|---|
| `loginOptions` | P | none | `{ users: string[] }` active user names only |
| `login` | P | `{ user, pin }` | `{ token, expiresAt, user: { name, role } }` |
| `me` | U | none | `{ name, role }` |
| `categories` | U | none | active categories `[{ name, color, order }]` sorted by order |
| `addExpense` | U | `{ date, item, price, category }` | created expense |
| `listExpenses` | U | `{ month?: "YYYY-MM", limit?: number }` | expenses, newest first. **Members: only their own rows, enforced server-side.** Admin: all rows, optional `user` filter |
| `updateExpense` | U | `{ id, date?, item?, price?, category? }` | updated expense. Members only on own rows |
| `deleteExpense` | U | `{ id }` | `{ id }`. Hard delete of the row. Members only on own rows |
| `summary` | U | `{ month: "YYYY-MM" }` | own summary: `{ month, total, byCategory: [{category, total}] }` |
| `changePin` | U | `{ oldPin, newPin }` | `{}` and bumps tokenVersion |
| `adminSummary` | A | `{ month, user?: string }` | family (or one user) summary: `{ total, byCategory, byUser: [{user,total}] }` |
| `adminCategories` | A | none | all categories incl. inactive |
| `addCategory` | A | `{ name, color }` | new category (unique name, active, order = max+1) |
| `updateCategory` | A | `{ name, color?, active?, order? }` | updated category |
| `renameCategory` | A | `{ oldName, newName }` | rewrites name in `Categories` **and** every matching `Expenses.category` |
| `adminUsers` | A | none | `[{ name, role, active }]` |
| `addUser` | A | `{ name, pin }` | new member |
| `setUserActive` | A | `{ name, active }` | updated user |
| `setPin` | A | `{ user, pin }` | `{}` and bumps that user's tokenVersion |

There is **no** `deleteCategory` and no `deleteUser`: only `active = false`, so old expenses never lose their category/user.

### Business rules (server-side, in one place)

- **Validation**: `date` matches `YYYY-MM-DD` and is a real date; `item` trimmed, 1–100 chars; `price` number > 0, max 2 decimals, < 100000 (frontend converts `,` to `.`); `category` must exist and be **active** for add/update (existing rows with inactive categories stay valid).
- **Formula injection**: if a text value starts with `=`, `+`, `-` or `@`, prefix with `'` before writing to the Sheet.
- **Writes** (add/update/delete/rename/…) run inside `LockService.getScriptLock()` with `waitLock(10000)`. `renameCategory` is atomic under the same lock and must fail with `CONFLICT` if `newName` already exists.
- **Summary** is computed in script from `Expenses` for the given month (string compare on `yyyy-MM`). Include categories that appear in expenses even if inactive/removed. Round sums to 2 decimals.
- Never deactivate the last active admin; never change a user's role through the API (role changes are done manually in the Sheet).
- Users cannot be renamed in v1 (would orphan `Expenses.user`).
- Performance: read the sheet once per request with `getValues()` on the used range; no per-row calls. Data is small (thousands of rows at most).

## Frontend requirements

- **Target viewport: 360 CSS px wide** (that is the real width of a 720px-wide phone). Mobile-first; desktop just centers a max-width column. Must be comfortable with one thumb: tap targets ≥ 44px, bottom tab bar.
- UI language: **Bulgarian**. Code, comments and identifiers in English. Currency EUR, format with `Intl.NumberFormat('bg-BG', {style:'currency', currency:'EUR'})`.
- Screens
  1. **Login**: name chips + PIN pad (numeric). Token in `localStorage`. Auto-login while token is valid.
  2. **Add** (home): price (`inputmode="decimal"`, autofocus), item text, date (defaults to today in local time), category as **colored chips** using the category `color` (one tap, no dropdown), big Save button. After save: clear fields, keep date and show a small "saved" confirmation. Last-used category is preselected.
  3. **List**: current month, newest first, tap to edit, delete with confirm. Month switcher. Members see only their own.
  4. **Summary**: month switcher, total + per-category bars. Members: own data.
  5. **Admin** tab (admin only): family/per-user summary switcher, manage categories (add, rename, color, activate/deactivate, reorder), manage users (activate/deactivate, set PIN, add).
- Hiding admin UI from members is only cosmetic; the server enforces everything.
- Show loading and error states (Apps Script calls take 1–2 s). Disable Save while a request is in flight to avoid double submits.
- **PWA**: `manifest.webmanifest` (name, icons 192/512, `display: standalone`, theme color), minimal service worker that caches only the static app shell. **Never cache API calls.**
- Keep dependencies minimal: React, Vite, TypeScript. No state library, no CSS framework.

## Deployment

- **Frontend**: GitHub Actions workflow that builds `frontend` and deploys to GitHub Pages on push to `main`. `VITE_API_URL` provided as a repository variable.
- **Backend**: `clasp push`, then deploy. **Important**: redeploy with `clasp deploy --deploymentId <ID>` (or update the existing deployment) so the web app **URL stays the same**. A plain `clasp deploy` creates a new URL. Write the deployment ID into `backend/DEPLOY.md`.
- First deployment needs the Google authorization consent done once in the browser.

## Workflow and order of work

Do these in order, stopping after each so the owner can verify:

1. `backend/`: clasp setup, `initSecrets`, menu for PINs, auth (`loginOptions`, `login`, `me`) with lockout. Verify with curl.
2. Expenses and categories endpoints (U role), verify with curl including that a member cannot see or touch another member's rows.
3. Summary + all admin endpoints, including `renameCategory`. Verify with curl.
4. Frontend: login + Add screen, deployed to Pages, tested on a real phone.
5. List, Summary, Admin screens.
6. PWA polish, then migrate nothing else: old rows already live in the Sheet.

Rules for Claude Code: keep the code small and readable, no speculative features, no extra dependencies without asking, and ask before changing the Sheet schema or this API contract.
## Frontend status

All screens are built: Login, Add, List (edit/delete), Summary, Admin (categories and people), own-PIN change, PWA. The API contract is unchanged. Admin UI is hidden from members as a convenience only.

**Layout** (`frontend/src`)
- `api.ts` (the one `call()`), `auth.ts` (session in localStorage), `storage.ts` (guarded localStorage), `messages.ts` (server errors to Bulgarian), `write.ts` (`runWrite`: one mutating call, never retried).
- `App.tsx` (session check, login/shell switch), `Shell.tsx` (top bar, tab bar, menu), screens: `Login`, `AddScreen`, `ListScreen` + `ExpenseSheet`, `SummaryScreen`, `AdminScreen` → `AdminCategories`, `AdminUsers`, `ChangePin`.
- Shared: `components.tsx` (month switcher, sheet, confirm dialog, chips, color picker), `PinPad.tsx`, `useFetch.ts`, `categories.ts` (in-memory cache, invalidated by admin changes), `online.tsx` (offline banner), `toast.tsx`, `format.ts`, `types.ts`.
- `public/`: `manifest.webmanifest`, `sw.js`, `icons/`. The service worker caches only the app shell, never touches cross-origin requests or non-GET requests, and is registered only in production as `sw.js?v=<build id>` so every release installs a fresh worker.

**Rules the UI follows**
- A failed write (NETWORK or SERVER_ERROR) is never retried. The user sees the "not sure it was saved" message and the affected data is refetched.
- A wrong old PIN in `changePin` is FORBIDDEN, so the user stays logged in. A successful PIN change invalidates all tokens and returns to login.

**Mock mode** (dev only, no real API calls): `VITE_MOCK=1 npm run dev` in `frontend/`. Fake users: Петър (admin, PIN 123456), Добринка 1111, Ивомира 2222, Георги 3333. Add `?mockFail=network` (request not executed) or `?mockFail=lost` (executed, response lost) to the URL to test failed writes. The mock module is loaded by dynamic import behind `import.meta.env.DEV` and is not in production builds.

**Checks**: `npm run typecheck && npm run build` from `frontend/`.
