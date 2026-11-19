// Demo build only (vite --mode demo replaces ./supabase with this file; see vite.config.ts).
// Same actions, payloads, results and error codes as supabase.ts, on made-up data kept in
// memory: nothing is sent anywhere and a reload starts over. Keep it in step with supabase.ts.
import { ApiError } from '../api';
import { loadSession, type Role } from '../auth';
import type { AdminCategory, AdminUser, Category, Expense, SummaryData, Template, TrashExpense } from '../types';
import { DEMO_USERS } from './users';

// ---- made-up data (never real names or amounts: the repo is public) ----

interface DemoUser { name: string; role: Role }

interface CategoryRow { id: number; name: string; active: boolean; sort_order: number }
interface Row {
  id: number; user: string; category_id: number; amount: number; spent_on: string;
  description: string; family: boolean; created_at: string; deleted_at: string | null; client_id?: string;
}
interface TemplateRow { id: number; user: string; title: string; category_id: number; amount: number | null; family: boolean; sort_order: number }

const PALETTE = ['#d9ead3', '#cfe2f3', '#fff2cc', '#f4cccc', '#d9d2e9', '#fce5cd', '#d0e0e3', '#ead1dc', '#e6e6e6', '#c9daf8'];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];

const CATEGORY_NAMES = [
  'Храна - първа степен', 'Храна - втора степен', 'Битови', 'Гориво', 'Здраве',
  'Транспорт', 'Дрехи и обувки', 'Други - първа степен', 'Други - втора степен', 'Кредити',
];
const categoriesTable: CategoryRow[] = CATEGORY_NAMES.map((name, i) => ({ id: i + 1, name, active: true, sort_order: i + 1 }));
const cat = (name: string) => categoriesTable.find((c) => c.name === name)!.id;

// [category, description, min, max, family]
type Item = [string, string, number, number, boolean];
const ITEMS: Item[] = [
  ['Храна - първа степен', 'Пазар Лидл', 25, 70, true],
  ['Храна - първа степен', 'Хляб и мляко', 2, 5, true],
  ['Храна - първа степен', 'Месо', 15, 40, true],
  ['Храна - първа степен', 'Плодове и зеленчуци', 5, 20, true],
  ['Храна - първа степен', 'Обяд', 6, 12, false],
  ['Храна - втора степен', 'Кафе', 1.5, 3.5, false],
  ['Храна - втора степен', 'Сладолед', 2, 6, false],
  ['Храна - втора степен', 'Пица', 8, 25, false],
  ['Храна - втора степен', 'Ресторант', 40, 110, true],
  ['Гориво', 'Гориво', 30, 70, false],
  ['Транспорт', 'Билет за автобус', 1, 1.6, false],
  ['Транспорт', 'Паркинг', 1, 5, false],
  ['Здраве', 'Лекарства', 5, 40, true],
  ['Здраве', 'Витамини', 8, 20, true],
  ['Дрехи и обувки', 'Тениска', 8, 25, false],
  ['Дрехи и обувки', 'Обувки', 40, 90, false],
  ['Други - първа степен', 'Препарати за дома', 5, 20, true],
  ['Други - първа степен', 'Фризьор', 10, 20, false],
  ['Други - втора степен', 'Кино', 8, 14, false],
  ['Други - втора степен', 'Книга', 10, 25, false],
];

// What each person tends to buy (indexes into ITEMS) and how often (expenses per day).
const HABITS: Record<string, { items: number[]; perDay: number }> = {
  maria: { items: [4, 4, 5, 5, 7, 9, 11, 14, 18, 8, 0], perDay: 1.1 },
  georgi: { items: [0, 1, 2, 9, 9, 12, 16, 8, 5], perDay: 0.8 },
  elena: { items: [0, 1, 3, 3, 12, 13, 16, 17, 15, 6], perDay: 0.9 },
  niki: { items: [5, 6, 7, 10, 10, 11, 18, 19, 14], perDay: 0.7 },
};

// Same data on every load: a small seeded random generator.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

let nextId = 1;
const expensesTable: Row[] = [];
const templatesTable: TemplateRow[] = [];

(function seedData() {
  const rnd = seeded(20261119);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const add = (user: string, date: Date, item: Item, amount?: number, family?: boolean) => {
    const [category, description, min, max, fam] = item;
    const at = new Date(date);
    at.setHours(8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
    expensesTable.push({
      id: nextId++, user, category_id: cat(category), amount: round2(amount ?? min + rnd() * (max - min)),
      spent_on: ymd(date), description, family: family ?? fam, created_at: at.toISOString(), deleted_at: null,
    });
  };
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    for (const [user, h] of Object.entries(HABITS)) {
      let n = Math.floor(h.perDay + rnd());
      while (n-- > 0) add(user, d, ITEMS[h.items[Math.floor(rnd() * h.items.length)]]);
    }
    // monthly bills
    if (d.getDate() === 5) {
      add('elena', d, ['Битови', 'Ток', 80, 130, true]);
      add('elena', d, ['Битови', 'Вода', 30, 50, true]);
      add('elena', d, ['Битови', 'Интернет и телевизия', 30, 30, true]);
      add('maria', d, ['Битови', 'Телефон', 15, 15, false]);
    }
    if (d.getDate() === 15) add('georgi', d, ['Кредити', 'Кредит', 450, 450, true]);
  }
  // a few rows already in the trash
  for (const r of expensesTable.slice(-40).filter((_, i) => i % 13 === 0)) r.deleted_at = new Date().toISOString();

  const tpl = (user: string, title: string, category: string, amount: number | null, family: boolean) =>
    templatesTable.push({
      id: nextId++, user, title, category_id: cat(category), amount, family,
      sort_order: templatesTable.filter((t) => t.user === user).length + 1,
    });
  tpl('maria', 'Кафе', 'Храна - втора степен', 2.5, false);
  tpl('maria', 'Ресторант', 'Храна - втора степен', null, true);
  tpl('maria', 'Гориво', 'Гориво', null, false);
  tpl('georgi', 'Хляб и мляко', 'Храна - първа степен', 3.2, true);
  tpl('georgi', 'Гориво', 'Гориво', 50, false);
  tpl('elena', 'Пазар', 'Храна - първа степен', null, true);
  tpl('elena', 'Ток', 'Битови', null, true);
  tpl('niki', 'Билет за автобус', 'Транспорт', 1.6, false);
  tpl('niki', 'Кафе', 'Храна - втора степен', 2, false);
})();

// ---- session ----

// The logged-in demo user is whoever the stored UI session names (it survives a reload).
let current: DemoUser | null = null;

function me(): DemoUser {
  const name = current?.name ?? loadSession()?.user.name;
  const user = DEMO_USERS.find((u) => u.name === name);
  if (!user) throw new ApiError('UNAUTHORIZED', 'No session');
  current = user;
  return user;
}

function requireAdmin(): DemoUser {
  const u = me();
  if (u.role !== 'admin') throw new ApiError('FORBIDDEN', 'Admin only');
  return u;
}

function requireFamily(): DemoUser {
  const u = me();
  if (u.role === 'member') throw new ApiError('FORBIDDEN', 'Admin or parent only');
  return u;
}

export async function signOut(): Promise<void> {
  current = null;
}

// ---- helpers mirroring the RLS rules ----

// What a user may read: members their own live rows, parents all live rows, the admin all.
const visible = (u: DemoUser, r: Row) => u.role === 'admin' || (r.deleted_at === null && (u.role === 'parent' || r.user === u.name));

const catName = (id: number) => categoriesTable.find((c) => c.id === id)?.name ?? '';

function toExpense(r: Row): Expense {
  return {
    id: String(r.id), date: r.spent_on, item: r.description, price: r.amount, category: catName(r.category_id),
    user: r.user, family: r.family, createdAt: r.created_at,
  };
}

function activeCategoryId(name: string): number {
  const c = categoriesTable.find((x) => x.active && x.name === name);
  if (!c) throw new ApiError('BAD_REQUEST', 'category not available');
  return c.id;
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

// ---- categories ----

const categories = (): Category[] =>
  [...categoriesTable].sort((a, b) => a.sort_order - b.sort_order).filter((c) => c.active)
    .map((c) => ({ name: c.name, color: colorFor(c.id), order: c.sort_order }));

const toAdminCategory = (c: CategoryRow): AdminCategory => ({ name: c.name, color: colorFor(c.id), order: c.sort_order, active: c.active });

function findCategory(name: string): CategoryRow {
  const c = categoriesTable.find((x) => x.name === name);
  if (!c) throw new ApiError('NOT_FOUND', 'category not found');
  return c;
}

function checkNewName(raw: string, exceptId?: number): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 50) throw new ApiError('BAD_REQUEST', 'name must be 1-50 characters');
  if (categoriesTable.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError('CONFLICT', 'category already exists');
  }
  return name;
}

// ---- expenses ----

function listExpenses(p: { month?: string; limit?: number; user?: string }): Expense[] {
  const u = me();
  let rows = expensesTable.filter((r) => r.deleted_at === null && visible(u, r));
  if (p.month) rows = rows.filter((r) => r.spent_on >= `${p.month}-01` && r.spent_on < nextMonthStart(p.month!));
  if (u.role === 'member') rows = rows.filter((r) => r.user === u.name);
  else if (p.user) rows = rows.filter((r) => r.user === p.user);
  rows.sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at));
  return (p.limit ? rows.slice(0, p.limit) : rows).map(toExpense);
}

function addExpense(p: { date: string; item: string; price: number; category: string; family?: boolean; clientId: string; forUser?: string }): Expense {
  const u = me();
  if (p.forUser && p.forUser !== u.name) throw new ApiError('FORBIDDEN', 'queued for a different user');
  const existing = expensesTable.find((r) => r.client_id === p.clientId);
  if (existing) return toExpense(existing); // same client_id = already saved
  const row: Row = {
    id: nextId++, user: u.name, category_id: activeCategoryId(p.category), amount: p.price, spent_on: p.date,
    description: p.item, family: p.family === true, created_at: new Date().toISOString(), deleted_at: null, client_id: p.clientId,
  };
  expensesTable.push(row);
  return toExpense(row);
}

function ownLiveRow(id: string): Row {
  const u = me();
  const r = expensesTable.find((x) => x.id === Number(id) && x.deleted_at === null && (u.role === 'admin' || x.user === u.name));
  if (!r) throw new ApiError('NOT_FOUND', 'expense not found');
  return r;
}

function updateExpense(p: { id: string; date?: string; item?: string; price?: number; category?: string; family?: boolean }): Expense {
  const r = ownLiveRow(p.id);
  if (p.category !== undefined) r.category_id = activeCategoryId(p.category);
  if (p.date !== undefined) r.spent_on = p.date;
  if (p.item !== undefined) r.description = p.item;
  if (p.price !== undefined) r.amount = p.price;
  if (p.family !== undefined) r.family = p.family;
  return toExpense(r);
}

function deleteExpense(p: { id: string }): { id: string } {
  ownLiveRow(p.id).deleted_at = new Date().toISOString();
  return { id: p.id };
}

// ---- templates ----

function toTemplate(t: TemplateRow): Template {
  const c = categoriesTable.find((x) => x.id === t.category_id);
  return { id: String(t.id), title: t.title, category: c?.name ?? '', categoryActive: c?.active ?? false, amount: t.amount, family: t.family, order: t.sort_order };
}

function checkTemplate(p: { title: string; amount: number | null }): string {
  const title = p.title.trim();
  if (title.length < 1 || title.length > 100) throw new ApiError('BAD_REQUEST', 'item must be 1-100 characters');
  if (p.amount !== null && !(p.amount > 0 && round2(p.amount) === p.amount && p.amount < 100000)) {
    throw new ApiError('BAD_REQUEST', 'price is invalid');
  }
  return title;
}

const myTemplates = () => {
  const u = me();
  return templatesTable.filter((t) => t.user === u.name).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
};

function ownTemplate(id: string): TemplateRow {
  const t = myTemplates().find((x) => x.id === Number(id));
  if (!t) throw new ApiError('NOT_FOUND', 'template not found');
  return t;
}

// ---- summaries ----

function summarize(month: string, user?: string): SummaryData {
  const u = me();
  const rows = expensesTable.filter(
    (r) => r.deleted_at === null && visible(u, r) && r.spent_on >= `${month}-01` && r.spent_on < nextMonthStart(month) && (!user || r.user === user),
  );
  const group = (key: (r: Row) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + r.amount));
    return [...m].map(([k, v]) => ({ k, total: round2(v) })).sort((a, b) => b.total - a.total);
  };
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const family = round2(rows.filter((r) => r.family).reduce((s, r) => s + r.amount, 0));
  return {
    total,
    personal: round2(total - family),
    family,
    byCategory: group((r) => catName(r.category_id)).map(({ k, total: t }) => ({ category: k, total: t })),
    byUser: group((r) => r.user).map(({ k, total: t }) => ({ user: k, total: t })),
    byUserCategory: [],
  };
}

// ---- dispatcher ----

const wait = () => new Promise((r) => setTimeout(r, 150)); // a little latency, so loading states show

export async function backendSend(action: string, payload: unknown): Promise<unknown> {
  await wait();
  const p = (payload ?? {}) as never;
  switch (action) {
    case 'login': {
      const { user } = p as { user: string; pin: string };
      const found = DEMO_USERS.find((u) => u.name === user.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase());
      if (!found) throw new ApiError('UNAUTHORIZED', 'Invalid credentials'); // any 6-digit PIN works
      current = found;
      return { user: { name: found.name, role: found.role } };
    }
    case 'bootstrap': {
      const u = me();
      return { me: { name: u.name, role: u.role }, categories: categories(), expenses: listExpenses({ month: (p as { month?: string }).month }) };
    }
    case 'categories': me(); return categories();
    case 'listExpenses': return listExpenses(p);
    case 'addExpense': return addExpense(p);
    case 'updateExpense': return updateExpense(p);
    case 'deleteExpense': return deleteExpense(p);
    case 'summary': return summarize((p as { month: string }).month, me().name);
    case 'adminSummary':
      requireFamily();
      return summarize((p as { month: string }).month, (p as { user?: string }).user);
    case 'adminUsers':
      requireFamily();
      return DEMO_USERS.map((u): AdminUser => ({ name: u.name, role: u.role, active: true })).sort((a, b) => a.name.localeCompare(b.name));
    case 'adminCategories':
      requireAdmin();
      return [...categoriesTable].sort((a, b) => a.sort_order - b.sort_order).map(toAdminCategory);
    case 'addCategory': {
      requireAdmin();
      const name = checkNewName((p as { name: string }).name);
      const row = { id: nextId++, name, active: true, sort_order: Math.max(0, ...categoriesTable.map((c) => c.sort_order)) + 1 };
      categoriesTable.push(row);
      return toAdminCategory(row);
    }
    case 'updateCategory': {
      requireAdmin();
      const { name, active, order } = p as { name: string; active?: boolean; order?: number };
      const c = findCategory(name);
      if (active !== undefined) c.active = active;
      if (order !== undefined) c.sort_order = order;
      return {};
    }
    case 'renameCategory': {
      requireAdmin();
      const { oldName, newName } = p as { oldName: string; newName: string };
      const c = findCategory(oldName);
      c.name = checkNewName(newName, c.id);
      return {};
    }
    case 'trash':
      requireAdmin();
      return expensesTable
        .filter((r) => r.deleted_at !== null)
        .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
        .map((r): TrashExpense => ({ ...toExpense(r), deletedAt: r.deleted_at! }));
    case 'restoreExpense':
    case 'purgeExpense': {
      requireAdmin();
      const { id } = p as { id: string };
      const i = expensesTable.findIndex((r) => r.id === Number(id) && r.deleted_at !== null);
      if (i < 0) throw new ApiError('NOT_FOUND', 'expense not found');
      if (action === 'restoreExpense') expensesTable[i].deleted_at = null;
      else expensesTable.splice(i, 1);
      return { id };
    }
    case 'templates': return myTemplates().map(toTemplate);
    case 'addTemplate': {
      const u = me();
      const t = p as { title: string; category: string; amount: number | null; family?: boolean };
      const row: TemplateRow = {
        id: nextId++, user: u.name, title: checkTemplate(t), category_id: activeCategoryId(t.category), amount: t.amount,
        family: t.family === true, sort_order: Math.max(0, ...myTemplates().map((x) => x.sort_order)) + 1,
      };
      templatesTable.push(row);
      return toTemplate(row);
    }
    case 'updateTemplate': {
      const t = p as { id: string; title: string; category: string; amount: number | null; family?: boolean };
      const row = ownTemplate(t.id);
      row.title = checkTemplate(t);
      row.category_id = activeCategoryId(t.category);
      row.amount = t.amount;
      row.family = t.family === true;
      return toTemplate(row);
    }
    case 'deleteTemplate': {
      const { id } = p as { id: string };
      const row = ownTemplate(id);
      templatesTable.splice(templatesTable.indexOf(row), 1);
      return { id };
    }
    case 'reorderTemplates':
      (p as { orders: { id: string; order: number }[] }).orders.forEach((o) => (ownTemplate(o.id).sort_order = o.order));
      return {};
    case 'changePin': me(); return {}; // nothing to change in the demo
    default:
      throw new ApiError('BAD_REQUEST', `action not supported: ${action}`);
  }
}
