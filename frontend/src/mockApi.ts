// DEV ONLY: in-memory stand-in for the Apps Script backend (VITE_MOCK=1 npm run dev).
// Mirrors the CLAUDE.md endpoint table and the server's validation and messages.
// All PINs here are fake dev data. URL options for testing failed and slow requests:
//   ?mockFail=network     mutating requests are never executed, every attempt fails
//   ?mockFail=networkonce the first attempt of each mutating request fails, the retry works
//   ?mockFail=lost        mutating requests ARE executed but every response is lost
//   ?mockFail=lostonce    executed, response lost on the first attempt only; the retry with
//                         the same requestId gets the stored response (like the real server)
//   ?mockFail=crossed     every other response (1st, 3rd...) is the PREVIOUS call's response
//                         (or the old "pong" for the very first call): a crossed response.
//                         Writes are executed, like a real response that went to the wrong request.
//   ?mockSlow=1           every call takes 3-8 seconds
import { ApiError, type Envelope, type ErrorCode } from './api';

interface MUser { name: string; role: 'admin' | 'member'; active: boolean; pin: string; tv: number }
interface MCategory { name: string; color: string; active: boolean; order: number }
interface MExpense { id: string; date: string; item: string; price: number; category: string; user: string; createdAt: string }

const users: MUser[] = [
  { name: 'Петър', role: 'admin', active: true, pin: '123456', tv: 0 },
  { name: 'Добринка', role: 'member', active: true, pin: '1111', tv: 0 },
  { name: 'Ивомира', role: 'member', active: true, pin: '2222', tv: 0 },
  { name: 'Георги', role: 'member', active: true, pin: '3333', tv: 0 },
];

const categories: MCategory[] = [
  { name: 'Храна', color: '#d9ead3', active: true, order: 1 },
  { name: 'Гориво', color: '#fce5cd', active: true, order: 2 },
  { name: 'Сметки', color: '#cfe2f3', active: true, order: 3 },
  { name: 'Забавление', color: '#ead1dc', active: true, order: 4 },
  { name: 'Дрехи', color: '#fff2cc', active: false, order: 5 },
];

const ITEMS: Record<string, string[]> = {
  Храна: ['Хляб и мляко', 'Пазар', 'Плодове', 'Обяд', 'Кафе'],
  Гориво: ['Бензин', 'Дизел'],
  Сметки: ['Ток', 'Интернет', 'Вода'],
  Забавление: ['Кино', 'Пица'],
  Дрехи: ['Тениска', 'Обувки'],
  Подаръци: ['Подарък за рожден ден'], // category that no longer exists in the Categories sheet
};

const expenses: MExpense[] = seedExpenses();

function seedExpenses(): MExpense[] {
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % n; // high bits: the low bits of this LCG are not random
  };
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const list: MExpense[] = [];
  const names = ['Петър', 'Добринка', 'Ивомира', 'Георги'];
  const cats = ['Храна', 'Храна', 'Храна', 'Гориво', 'Сметки', 'Забавление', 'Дрехи', 'Подаръци'];
  for (let i = 0; i < 25; i++) {
    const back = i < 14 ? 0 : 1; // 14 rows this month, 11 last month
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const maxDay = back === 0 ? today.getDate() : 28;
    d.setDate(1 + rnd(maxDay));
    // rows 14 and 15 (last month) always use an inactive and a removed category
    const category = i === 14 ? 'Дрехи' : i === 15 ? 'Подаръци' : cats[rnd(cats.length)];
    const itemList = ITEMS[category];
    list.push({
      id: newId(),
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      item: itemList[rnd(itemList.length)],
      price: (500 + rnd(9000)) / 100,
      category,
      user: names[i % names.length], // round robin: every user has data in both months
      createdAt: new Date(d.getTime() + i * 1000).toISOString(),
    });
  }
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 5);
  list.push({
    id: newId(),
    date: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-05`,
    item: 'Стар запис без потребител',
    price: 12.5,
    category: 'Храна',
    user: '', // legacy row: visible to the admin only
    createdAt: prev.toISOString(),
  });
  return list;
}

function newId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function fail(code: ErrorCode, message: string): never {
  throw new ApiError(code, message);
}

// ---- auth ----

const failedLogins = new Map<string, number>();

function auth(token: string | undefined, adminOnly = false): MUser {
  const m = /^mock:(.+):(\d+)$/.exec(token ?? '');
  const user = m && users.find((u) => u.name === m[1]);
  if (!user || !user.active || user.tv !== Number(m![2])) fail('UNAUTHORIZED', 'Invalid token');
  if (adminOnly && user.role !== 'admin') fail('FORBIDDEN', 'Admin only');
  return user;
}

function validatePin(pin: unknown, role: 'admin' | 'member'): string {
  const length = role === 'admin' ? 6 : 4;
  if (typeof pin !== 'string' || !new RegExp(`^\\d{${length}}$`).test(pin)) {
    fail('BAD_REQUEST', `PIN must be exactly ${length} digits`);
  }
  return pin;
}

// ---- validation ----

function validDate(v: unknown): string {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return fail('BAD_REQUEST', 'date must be YYYY-MM-DD');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) fail('BAD_REQUEST', 'date is not a real date');
  return m[0];
}

function validItem(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 100) fail('BAD_REQUEST', 'item must be 1-100 characters');
  return s;
}

function validPrice(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v >= 100000) {
    fail('BAD_REQUEST', 'price must be a number > 0 and < 100000');
  }
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) fail('BAD_REQUEST', 'price may have at most 2 decimals');
  return round2(v);
}

function validMonth(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) fail('BAD_REQUEST', 'month must be YYYY-MM');
  return v;
}

function validName(v: unknown, what: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 50) fail('BAD_REQUEST', `${what} must be 1-50 characters`);
  if (s === '(unassigned)') fail('BAD_REQUEST', 'Reserved name');
  return s;
}

function validColor(v: unknown): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail('BAD_REQUEST', 'color must be like #d9ead3');
  return v;
}

function activeCategory(name: unknown, current?: string): string {
  if (typeof name !== 'string') fail('BAD_REQUEST', 'category is required');
  if (current !== undefined && name === current) return name;
  const c = categories.find((x) => x.name === name);
  if (!c) fail('BAD_REQUEST', 'Unknown category');
  if (!c.active) fail('BAD_REQUEST', 'Category is not active');
  return c.name;
}

function ownedExpense(user: MUser, id: unknown): MExpense {
  const e = expenses.find((x) => x.id === id);
  if (!e) fail('NOT_FOUND', 'Expense not found');
  if (user.role !== 'admin' && e.user !== user.name) fail('FORBIDDEN', 'Not your expense');
  return e;
}

function summarize(rows: MExpense[]) {
  const cents = new Map<string, number>();
  for (const r of rows) cents.set(r.category, (cents.get(r.category) ?? 0) + Math.round(r.price * 100));
  const byCategory = [...cents].map(([category, c]) => ({ category, total: c / 100 })).sort((a, b) => b.total - a.total);
  return { total: round2(byCategory.reduce((s, r) => s + r.total, 0)), byCategory };
}

// ---- endpoints ----

type Payload = Record<string, unknown>;

function handle(action: string, p: Payload, token: string | undefined): unknown {
  switch (action) {
    case 'loginOptions':
      return { users: users.filter((u) => u.active).map((u) => u.name) };

    case 'login': {
      const name = String(p.user ?? '');
      if ((failedLogins.get(name) ?? 0) >= 5) fail('LOCKED', 'Too many attempts, try again later');
      const u = users.find((x) => x.name === name);
      if (!u || !u.active || u.pin !== p.pin) {
        failedLogins.set(name, (failedLogins.get(name) ?? 0) + 1);
        fail('UNAUTHORIZED', 'Invalid name or PIN');
      }
      failedLogins.delete(name);
      return {
        token: `mock:${u.name}:${u.tv}`,
        expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400,
        user: { name: u.name, role: u.role },
      };
    }

    case 'me': {
      const u = auth(token);
      return { name: u.name, role: u.role };
    }

    case 'bootstrap': {
      const u = auth(token);
      return {
        me: { name: u.name, role: u.role },
        categories: handle('categories', {}, token),
        expenses: handle('listExpenses', p.month === undefined ? {} : { month: p.month }, token),
      };
    }

    case 'categories':
      auth(token);
      return categories.filter((c) => c.active).sort((a, b) => a.order - b.order).map(({ name, color, order }) => ({ name, color, order }));

    case 'addExpense': {
      const u = auth(token);
      const e: MExpense = {
        id: newId(),
        date: validDate(p.date),
        item: validItem(p.item),
        price: validPrice(p.price),
        category: activeCategory(p.category),
        user: u.name,
        createdAt: new Date().toISOString(),
      };
      expenses.push(e);
      return e;
    }

    case 'listExpenses': {
      const u = auth(token);
      const month = p.month === undefined ? null : validMonth(p.month);
      const only = u.role === 'admin' ? (p.user as string | undefined) : u.name;
      const rows = expenses
        .filter((e) => (!only || e.user === only) && (!month || e.date.startsWith(month)))
        .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
      return typeof p.limit === 'number' ? rows.slice(0, p.limit) : rows;
    }

    case 'updateExpense': {
      const u = auth(token);
      if (p.date === undefined && p.item === undefined && p.price === undefined && p.category === undefined) {
        fail('BAD_REQUEST', 'Nothing to update');
      }
      const date = p.date === undefined ? null : validDate(p.date);
      const item = p.item === undefined ? null : validItem(p.item);
      const price = p.price === undefined ? null : validPrice(p.price);
      const e = ownedExpense(u, p.id);
      const category = p.category === undefined ? null : activeCategory(p.category, e.category);
      if (date) e.date = date;
      if (item !== null) e.item = item;
      if (price !== null) e.price = price;
      if (category !== null) e.category = category;
      return e;
    }

    case 'deleteExpense': {
      const e = ownedExpense(auth(token), p.id);
      expenses.splice(expenses.indexOf(e), 1);
      return { id: e.id };
    }

    case 'summary': {
      const u = auth(token);
      const month = validMonth(p.month);
      return { month, ...summarize(expenses.filter((e) => e.user === u.name && e.date.startsWith(month))) };
    }

    case 'changePin': {
      const u = auth(token);
      const newPin = validatePin(p.newPin, u.role);
      if (u.pin !== p.oldPin) fail('FORBIDDEN', 'Wrong PIN');
      u.pin = newPin;
      u.tv++;
      return {};
    }

    // ---- admin ----

    case 'adminSummary': {
      auth(token, true);
      const month = validMonth(p.month);
      let rows = expenses.filter((e) => e.date.startsWith(month));
      if (p.user !== undefined) {
        if (!users.some((x) => x.name === p.user)) fail('NOT_FOUND', 'User not found');
        rows = rows.filter((e) => e.user === p.user);
      }
      const cents = new Map<string, number>();
      for (const r of rows) cents.set(r.user || '(unassigned)', (cents.get(r.user || '(unassigned)') ?? 0) + Math.round(r.price * 100));
      const byUser = [...cents].map(([user, c]) => ({ user, total: c / 100 })).sort((a, b) => b.total - a.total);
      return { ...summarize(rows), byUser };
    }

    case 'adminCategories':
      auth(token, true);
      return [...categories].sort((a, b) => a.order - b.order);

    case 'addCategory': {
      auth(token, true);
      const name = validName(p.name, 'name');
      const color = validColor(p.color);
      if (categories.some((c) => c.name === name)) fail('CONFLICT', 'Category already exists');
      const c = { name, color, active: true, order: Math.max(0, ...categories.map((x) => x.order)) + 1 };
      categories.push(c);
      return c;
    }

    case 'updateCategory': {
      auth(token, true);
      const c = categories.find((x) => x.name === p.name);
      if (!c) fail('NOT_FOUND', 'Category not found');
      if (p.color === undefined && p.active === undefined && p.order === undefined) fail('BAD_REQUEST', 'Nothing to update');
      if (p.color !== undefined) c.color = validColor(p.color);
      if (p.active !== undefined) {
        if (typeof p.active !== 'boolean') fail('BAD_REQUEST', 'active must be true or false');
        c.active = p.active;
      }
      if (p.order !== undefined) {
        if (!Number.isInteger(p.order)) fail('BAD_REQUEST', 'order must be an integer');
        c.order = p.order as number;
      }
      return c;
    }

    case 'renameCategory': {
      auth(token, true);
      const c = categories.find((x) => x.name === p.oldName);
      if (!c) fail('NOT_FOUND', 'Category not found');
      const newName = validName(p.newName, 'newName');
      if (newName === c.name) return c;
      if (categories.some((x) => x.name === newName)) fail('CONFLICT', 'Category already exists');
      expenses.forEach((e) => {
        if (e.category === c.name) e.category = newName;
      });
      c.name = newName;
      return c;
    }

    case 'adminUsers':
      auth(token, true);
      return users.map(({ name, role, active }) => ({ name, role, active }));

    case 'addUser': {
      auth(token, true);
      const name = validName(p.name, 'name');
      const pin = validatePin(p.pin, 'member');
      if (users.some((u) => u.name === name)) fail('CONFLICT', 'User already exists');
      users.push({ name, role: 'member', active: true, pin, tv: 0 });
      return { name, role: 'member', active: true };
    }

    case 'setUserActive': {
      auth(token, true);
      const u = users.find((x) => x.name === p.name);
      if (!u) fail('NOT_FOUND', 'User not found');
      if (typeof p.active !== 'boolean') fail('BAD_REQUEST', 'active must be true or false');
      if (!p.active && u.active && u.role === 'admin' && !users.some((x) => x !== u && x.role === 'admin' && x.active)) {
        fail('CONFLICT', 'Cannot deactivate the last active admin');
      }
      u.active = p.active;
      if (!p.active) u.tv++;
      return { name: u.name, role: u.role, active: u.active };
    }

    case 'setPin': {
      auth(token, true);
      const u = users.find((x) => x.name === p.user);
      if (!u) fail('NOT_FOUND', 'User not found');
      u.pin = validatePin(p.pin, u.role);
      u.tv++;
      failedLogins.delete(u.name);
      return {};
    }
  }
  return fail('BAD_REQUEST', `Unknown action: ${action}`);
}

// Same extra fields as the real server: ms always, timing only for debug requests.
function withTiming(result: Envelope, debug?: boolean): Envelope {
  result.ms = 3;
  if (debug) result.timing = { auth: 1, open: 0, read: 1, lock: 0, handler: 1, total: 3 };
  return result;
}

const MUTATING = new Set([
  'addExpense', 'updateExpense', 'deleteExpense', 'changePin', 'addCategory', 'updateCategory',
  'renameCategory', 'addUser', 'setUserActive', 'setPin',
]);

// Stored responses by user + requestId, like the real server's 30 minute replay cache.
const replays = new Map<string, { at: number; data: unknown }>();
const attempts = new Map<string, number>();
let callCounter = 0;
let previousEnvelope: Envelope | undefined; // what a crossed response delivers
const PONG: Envelope = { ok: true, data: 'pong' }; // the old doGet answer: no echo at all
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function mockSend(
  action: string,
  payload: object | undefined,
  token: string | undefined,
  debug?: boolean,
  requestId?: string,
): Promise<Envelope> {
  const params = new URLSearchParams(location.search);
  const callNo = ++callCounter;
  await new Promise((r) => setTimeout(r, params.get('mockSlow') === '1' ? 3000 + Math.random() * 5000 : 250));
  const mode = params.get('mockFail');
  const mutating = MUTATING.has(action);

  let attemptNo = 0;
  if (mutating && requestId) {
    attemptNo = (attempts.get(requestId) ?? 0) + 1;
    attempts.set(requestId, attemptNo);
  }
  if (mutating && (mode === 'network' || (mode === 'networkonce' && attemptNo === 1))) {
    throw new ApiError('NETWORK', 'mock: request not executed');
  }

  try {
    if (requestId !== undefined && !REQUEST_ID.test(requestId)) fail('BAD_REQUEST', 'requestId must be 8-64 characters');
    const who = /^mock:(.+):\d+$/.exec(token ?? '')?.[1];
    const replayKey = mutating && requestId && who ? `${who}:${requestId}` : null;
    const stored = replayKey ? replays.get(replayKey) : undefined;

    let data: unknown;
    if (stored && Date.now() - stored.at < 30 * 60 * 1000) {
      data = stored.data; // replay: not executed again
    } else {
      data = handle(action, (payload ?? {}) as Payload, token);
      if (replayKey) replays.set(replayKey, { at: Date.now(), data: JSON.parse(JSON.stringify(data ?? null)) });
    }

    if (mutating && (mode === 'lost' || (mode === 'lostonce' && attemptNo === 1))) {
      throw new ApiError('NETWORK', 'mock: executed, response lost');
    }
    return deliver(withTiming({ ok: true, data: JSON.parse(JSON.stringify(data ?? null)) }, debug), action, requestId, mode, callNo);
  } catch (e) {
    if (e instanceof ApiError && e.code !== 'NETWORK') {
      return deliver(withTiming({ ok: false, error: { code: e.code, message: e.message } }, debug), action, requestId, mode, callNo);
    }
    throw e;
  }
}

// Adds the echo the real server adds, and in crossed mode swaps in somebody else's response.
function deliver(envelope: Envelope, action: string, requestId: string | undefined, mode: string | null, callNo: number): Envelope {
  envelope.action = action;
  if (requestId !== undefined) envelope.requestId = requestId;
  const crossed = mode === 'crossed' && callNo % 2 === 1;
  const out = crossed ? (previousEnvelope ?? PONG) : envelope;
  previousEnvelope = envelope;
  return JSON.parse(JSON.stringify(out));
}
