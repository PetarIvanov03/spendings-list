import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ErrorCode } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import type { Role } from './auth';
import type { AdminCategory, AdminUser, Category, Expense, SummaryData, Template, TrashExpense } from './types';

// Backend actions on Supabase. Same action names and result shapes the screens already use
// (names instead of ids, string expense ids), so the UI did not change. Security is RLS.

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new ApiError('NETWORK', 'Supabase is not configured (src/config.ts)');
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

export async function signOut(): Promise<void> {
  profile = null;
  try {
    // 'local': only this device. The default (global) would log the user out everywhere.
    await db().auth.signOut({ scope: 'local' });
  } catch {
    /* not configured or offline: the local session is cleared anyway */
  }
}

// ---- helpers ----

interface DbError { code?: string; message?: string; status?: number; name?: string }

const isTransport = (e: DbError) =>
  /failed to fetch|network|fetch failed|load failed/i.test(e.message ?? '') || e.name === 'AuthRetryableFetchError';

function fail(e: DbError): never {
  const msg = e.message ?? '';
  let code: ErrorCode = 'SERVER_ERROR';
  if (isTransport(e)) code = 'NETWORK';
  else if (e.status === 401 || e.code === 'PGRST301' || /jwt/i.test(msg)) code = 'UNAUTHORIZED';
  else if (e.code === '42501' || e.status === 403) code = 'FORBIDDEN';
  else if (e.code === '23505') code = 'CONFLICT';
  else if (e.code === '23514' || e.code === '22P02' || e.code === '23502') code = 'BAD_REQUEST';
  throw new ApiError(code, msg);
}

// Typed name -> email local part: trim, collapse spaces, NFC, lower case.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
}
const emailFor = (name: string) => `${normalizeName(name)}@spendings.app`;

const round2 = (n: number) => Math.round(n * 100) / 100;

function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

// The categories table has no color column: pick a stable pastel per category id.
const PALETTE = ['#d9ead3', '#cfe2f3', '#fff2cc', '#f4cccc', '#d9d2e9', '#fce5cd', '#d0e0e3', '#ead1dc', '#e6e6e6', '#c9daf8'];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];

// ---- profile / session ----

interface Profile { id: string; name: string; role: Role }
let profile: Profile | null = null;

async function me(): Promise<Profile> {
  if (profile) return profile;
  const { data: s, error: se } = await db().auth.getSession();
  if (se) fail(se);
  const uid = s.session?.user.id;
  if (!uid) throw new ApiError('UNAUTHORIZED', 'No session');
  const { data, error } = await db().from('profiles').select('id,name,is_admin').eq('id', uid).maybeSingle();
  if (error) fail(error);
  if (!data) throw new ApiError('UNAUTHORIZED', 'No profile');
  profile = { id: data.id, name: data.name, role: data.is_admin ? 'admin' : 'member' };
  return profile;
}

async function requireAdmin(): Promise<Profile> {
  const p = await me();
  if (p.role !== 'admin') throw new ApiError('FORBIDDEN', 'Admin only');
  return p;
}

// ---- categories ----

interface CategoryRow { id: number; name: string; active: boolean; sort_order: number }

async function allCategories(): Promise<CategoryRow[]> {
  const { data, error } = await db().from('categories').select('id,name,active,sort_order').order('sort_order');
  if (error) fail(error);
  return data as CategoryRow[];
}

async function categories(): Promise<Category[]> {
  return (await allCategories())
    .filter((c) => c.active)
    .map((c) => ({ name: c.name, color: colorFor(c.id), order: c.sort_order }));
}

const NAME_ERROR = 'name must be 1-50 characters';

async function adminCategories(): Promise<AdminCategory[]> {
  await requireAdmin();
  return (await allCategories()).map((c) => ({ name: c.name, color: colorFor(c.id), order: c.sort_order, active: c.active }));
}

async function findCategory(name: string): Promise<CategoryRow> {
  const found = (await allCategories()).find((c) => c.name === name);
  if (!found) throw new ApiError('NOT_FOUND', 'category not found');
  return found;
}

// Unique-name check in code too, in case the table has no unique constraint.
async function checkNewName(raw: string, exceptId?: number): Promise<string> {
  const name = raw.trim();
  if (name.length < 1 || name.length > 50) throw new ApiError('BAD_REQUEST', NAME_ERROR);
  const clash = (await allCategories()).some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ApiError('CONFLICT', 'category already exists');
  return name;
}

function categoryWriteError(e: DbError): never {
  if (e.code === '23505') throw new ApiError('CONFLICT', 'category already exists');
  fail(e);
}

async function addCategory(p: { name: string }): Promise<AdminCategory> {
  await requireAdmin();
  const name = await checkNewName(p.name);
  const max = Math.max(0, ...(await allCategories()).map((c) => c.sort_order));
  const { data, error } = await db().from('categories').insert({ name, sort_order: max + 1 }).select('id,name,active,sort_order').single();
  if (error) categoryWriteError(error);
  const c = data as CategoryRow;
  return { name: c.name, color: colorFor(c.id), order: c.sort_order, active: c.active };
}

async function updateCategory(p: { name: string; active?: boolean; order?: number }): Promise<Record<string, never>> {
  await requireAdmin();
  const c = await findCategory(p.name);
  const patch: Record<string, unknown> = {};
  if (p.active !== undefined) patch.active = p.active;
  if (p.order !== undefined) patch.sort_order = p.order;
  const { data, error } = await db().from('categories').update(patch).eq('id', c.id).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('FORBIDDEN', 'category not updated');
  return {};
}

// Expenses point to category_id, so renaming the row renames it everywhere.
async function renameCategory(p: { oldName: string; newName: string }): Promise<Record<string, never>> {
  await requireAdmin();
  const c = await findCategory(p.oldName);
  const name = await checkNewName(p.newName, c.id);
  const { data, error } = await db().from('categories').update({ name }).eq('id', c.id).select('id');
  if (error) categoryWriteError(error);
  if (!data || data.length === 0) throw new ApiError('FORBIDDEN', 'category not updated');
  return {};
}

// ---- expenses ----

interface ExpenseRow {
  id: number; user_id: string; category_id: number; amount: number | string;
  spent_on: string; description: string; created_at: string;
}
const EXPENSE_COLS = 'id,user_id,category_id,amount,spent_on,description,created_at';

async function profileNames(): Promise<Map<string, string>> {
  const { data, error } = await db().from('profiles').select('id,name');
  if (error) fail(error);
  return new Map((data as { id: string; name: string }[]).map((p) => [p.id, p.name]));
}

async function mapExpenses(rows: ExpenseRow[]): Promise<Expense[]> {
  const [cats, names] = await Promise.all([allCategories(), profileNames()]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: String(r.id),
    date: r.spent_on,
    item: r.description,
    price: Number(r.amount),
    category: catName.get(r.category_id) ?? '',
    user: names.get(r.user_id) ?? '',
    createdAt: r.created_at,
  }));
}

async function categoryId(name: string): Promise<number> {
  const found = (await allCategories()).find((c) => c.active && c.name === name);
  if (!found) throw new ApiError('BAD_REQUEST', 'category not available');
  return found.id;
}

async function listExpenses(p: { month?: string; limit?: number; user?: string } = {}): Promise<Expense[]> {
  const who = await me();
  // deleted_at is ALWAYS filtered: the admin's RLS would otherwise show the trash too.
  let q = db().from('expenses').select(EXPENSE_COLS).is('deleted_at', null);
  if (p.month) q = q.gte('spent_on', `${p.month}-01`).lt('spent_on', nextMonthStart(p.month));
  if (who.role !== 'admin') {
    q = q.eq('user_id', who.id);
  } else if (p.user) {
    const id = [...(await profileNames())].find(([, n]) => n === p.user)?.[0];
    if (!id) return [];
    q = q.eq('user_id', id);
  }
  q = q.order('spent_on', { ascending: false }).order('created_at', { ascending: false });
  if (p.limit) q = q.limit(p.limit);
  const { data, error } = await q;
  if (error) fail(error);
  return mapExpenses(data as ExpenseRow[]);
}

// clientId makes the insert idempotent: expenses.client_id is unique, so a repeat of the same
// expense (retry, resend after reconnect, reload) fails with 23505. That means "already saved":
// the existing row is fetched and returned like a normal insert. client_id never leaves here.
async function addExpense(p: { date: string; item: string; price: number; category: string; clientId: string; forUser?: string }): Promise<Expense> {
  const who = await me();
  // A queued expense belongs to the user who made it: a retry that fires after someone else
  // logged in must not be written under the new account.
  if (p.forUser && p.forUser !== who.name) throw new ApiError('FORBIDDEN', 'queued for a different user');
  const { data, error } = await db()
    .from('expenses')
    .insert({ category_id: await categoryId(p.category), amount: p.price, spent_on: p.date, description: p.item, client_id: p.clientId })
    .select(EXPENSE_COLS)
    .single();
  if (!error) return (await mapExpenses([data as ExpenseRow]))[0];
  if (error.code !== '23505' || !/client_id/.test(error.message ?? '')) fail(error);
  const existing = await db().from('expenses').select(EXPENSE_COLS).eq('client_id', p.clientId).maybeSingle();
  if (existing.error) fail(existing.error);
  if (!existing.data) fail(error);
  return (await mapExpenses([existing.data as ExpenseRow]))[0];
}

async function updateExpense(p: { id: string; date?: string; item?: string; price?: number; category?: string }): Promise<Expense> {
  await me();
  const patch: Record<string, unknown> = {};
  if (p.date !== undefined) patch.spent_on = p.date;
  if (p.item !== undefined) patch.description = p.item;
  if (p.price !== undefined) patch.amount = p.price;
  if (p.category !== undefined) patch.category_id = await categoryId(p.category);
  const { data, error } = await db()
    .from('expenses')
    .update(patch)
    .eq('id', Number(p.id))
    .is('deleted_at', null)
    .select(EXPENSE_COLS);
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND', 'expense not found');
  return (await mapExpenses(data as ExpenseRow[]))[0];
}

async function deleteExpense(p: { id: string }): Promise<{ id: string }> {
  await me();
  const { error } = await db().rpc('delete_expense', { p_id: Number(p.id) });
  if (error) fail(error);
  return { id: p.id };
}

// ---- personal templates (RLS: each user sees and changes only their own) ----

interface TemplateRow { id: number; title: string; category_id: number; amount: number | string | null; sort_order: number }
const TEMPLATE_COLS = 'id,title,category_id,amount,sort_order';

async function toTemplates(rows: TemplateRow[]): Promise<Template[]> {
  const cats = new Map((await allCategories()).map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: String(r.id),
    title: r.title,
    category: cats.get(r.category_id)?.name ?? '',
    categoryActive: cats.get(r.category_id)?.active ?? false,
    amount: r.amount === null ? null : Number(r.amount),
    order: r.sort_order,
  }));
}

function checkTemplate(p: { title: string; amount: number | null }): string {
  const title = p.title.trim();
  if (title.length < 1 || title.length > 100) throw new ApiError('BAD_REQUEST', 'item must be 1-100 characters');
  if (p.amount !== null && !(p.amount > 0 && Math.round(p.amount * 100) / 100 === p.amount && p.amount < 100000)) {
    throw new ApiError('BAD_REQUEST', 'price is invalid');
  }
  return title;
}

async function templates(): Promise<Template[]> {
  const who = await me();
  const { data, error } = await db().from('templates').select(TEMPLATE_COLS).eq('user_id', who.id).order('sort_order').order('id');
  if (error) fail(error);
  return toTemplates(data as TemplateRow[]);
}

async function addTemplate(p: { title: string; category: string; amount: number | null }): Promise<Template> {
  const who = await me();
  const title = checkTemplate(p);
  const max = Math.max(0, ...(await templates()).map((t) => t.order));
  const { data, error } = await db()
    .from('templates')
    .insert({ title, category_id: await categoryId(p.category), amount: p.amount, sort_order: max + 1, user_id: who.id })
    .select(TEMPLATE_COLS)
    .single();
  if (error) fail(error);
  return (await toTemplates([data as TemplateRow]))[0];
}

async function updateTemplate(p: { id: string; title: string; category: string; amount: number | null }): Promise<Template> {
  const who = await me();
  const title = checkTemplate(p);
  const { data, error } = await db()
    .from('templates')
    .update({ title, category_id: await categoryId(p.category), amount: p.amount })
    .eq('id', Number(p.id))
    .eq('user_id', who.id)
    .select(TEMPLATE_COLS);
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND', 'template not found');
  return (await toTemplates(data as TemplateRow[]))[0];
}

async function deleteTemplate(p: { id: string }): Promise<{ id: string }> {
  const who = await me();
  const { data, error } = await db().from('templates').delete().eq('id', Number(p.id)).eq('user_id', who.id).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND', 'template not found');
  return { id: p.id };
}

// Sets sort_order of the given templates (the caller sends only those that changed).
async function reorderTemplates(p: { orders: { id: string; order: number }[] }): Promise<Record<string, never>> {
  const who = await me();
  const results = await Promise.all(
    p.orders.map((o) => db().from('templates').update({ sort_order: o.order }).eq('id', Number(o.id)).eq('user_id', who.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) fail(failed.error);
  return {};
}

// ---- trash (admin) ----

async function trash(): Promise<TrashExpense[]> {
  await requireAdmin();
  const { data, error } = await db()
    .from('expenses')
    .select(`${EXPENSE_COLS},deleted_at`)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) fail(error);
  const rows = data as (ExpenseRow & { deleted_at: string })[];
  const mapped = await mapExpenses(rows);
  return mapped.map((e, i) => ({ ...e, deletedAt: rows[i].deleted_at }));
}

async function restoreExpense(p: { id: string }): Promise<{ id: string }> {
  await requireAdmin();
  const { data, error } = await db()
    .from('expenses')
    .update({ deleted_at: null })
    .eq('id', Number(p.id))
    .not('deleted_at', 'is', null)
    .select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND', 'expense not found');
  return { id: p.id };
}

async function purgeExpense(p: { id: string }): Promise<{ id: string }> {
  await requireAdmin();
  const { data, error } = await db().from('expenses').delete().eq('id', Number(p.id)).not('deleted_at', 'is', null).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND', 'expense not found');
  return { id: p.id };
}

// ---- summaries ----

type Row<K extends string> = Record<K, string> & { total: number };

function sorted<K extends string>(m: Map<string, number>, key: K): Row<K>[] {
  return [...m]
    .map(([k, v]) => ({ [key]: k, total: round2(v) }) as Row<K>)
    .sort((a, b) => b.total - a.total);
}

async function summarize(month: string, opts: { userName?: string; userId?: string }): Promise<SummaryData> {
  const names = await profileNames();
  let userId = opts.userId;
  if (opts.userName) {
    userId = [...names].find(([, n]) => n === opts.userName)?.[0];
    if (!userId) return { total: 0, byCategory: [], byUser: [], byUserCategory: [] };
  }
  let q = db().from('monthly_totals').select('user_id,category_id,total').eq('month', `${month}-01`);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) fail(error);

  const catName = new Map((await allCategories()).map((c) => [c.id, c.name]));
  const byCat = new Map<string, number>();
  const byUser = new Map<string, number>();
  const byUserCat = new Map<string, Map<string, number>>();
  let total = 0;
  for (const r of data as { user_id: string; category_id: number; total: number | string }[]) {
    const t = Number(r.total);
    const c = catName.get(r.category_id) ?? '';
    const u = names.get(r.user_id) ?? '';
    total += t;
    byCat.set(c, (byCat.get(c) ?? 0) + t);
    byUser.set(u, (byUser.get(u) ?? 0) + t);
    const m = byUserCat.get(u) ?? new Map<string, number>();
    m.set(c, (m.get(c) ?? 0) + t);
    byUserCat.set(u, m);
  }
  return {
    total: round2(total),
    byCategory: sorted(byCat, 'category'),
    byUser: sorted(byUser, 'user'),
    byUserCategory: [...byUserCat].map(([user, m]) => ({ user, byCategory: sorted(m, 'category') })),
  };
}

// ---- people: read-only (creating users and setting PINs needs a secret key) ----

async function adminUsers(): Promise<AdminUser[]> {
  await requireAdmin();
  const { data, error } = await db().from('profiles').select('name,is_admin').order('name');
  if (error) fail(error);
  return (data as { name: string; is_admin: boolean }[]).map((u) => ({
    name: u.name,
    role: u.is_admin ? 'admin' : 'member',
    active: true,
  }));
}

// ---- auth ----

async function login(p: { user: string; pin: string }) {
  profile = null;
  const { error } = await db().auth.signInWithPassword({ email: emailFor(p.user), password: p.pin });
  // Wrong name and wrong PIN get the same error; only a transport problem is told apart.
  if (error) {
    if (isTransport(error)) fail(error);
    throw new ApiError('UNAUTHORIZED', 'Invalid credentials');
  }
  const who = await me();
  // supabase-js keeps (and refreshes) the real session; this one only drives the UI.
  return { token: 'supabase', expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400, user: { name: who.name, role: who.role } };
}

async function changePin(p: { oldPin: string; newPin: string }): Promise<Record<string, never>> {
  const who = await me();
  const check = await db().auth.signInWithPassword({ email: emailFor(who.name), password: p.oldPin });
  if (check.error) throw new ApiError('FORBIDDEN', 'Wrong old PIN');
  const { error } = await db().auth.updateUser({ password: p.newPin });
  if (error) fail(error);
  return {};
}

// ---- dispatcher ----

export async function backendSend(action: string, payload: unknown): Promise<unknown> {
  const p = (payload ?? {}) as never; // shape is the caller's contract (see types.ts)
  switch (action) {
    case 'login': return login(p);
    case 'me': { const w = await me(); return { name: w.name, role: w.role }; }
    case 'bootstrap': {
      const w = await me();
      const [cats, expenses] = await Promise.all([categories(), listExpenses({ month: (p as { month?: string }).month })]);
      return { me: { name: w.name, role: w.role }, categories: cats, expenses };
    }
    case 'categories': return categories();
    case 'listExpenses': return listExpenses(p);
    case 'addExpense': return addExpense(p);
    case 'updateExpense': return updateExpense(p);
    case 'deleteExpense': return deleteExpense(p);
    case 'summary': return summarize((p as { month: string }).month, { userId: (await me()).id });
    case 'adminSummary':
      await requireAdmin();
      return summarize((p as { month: string }).month, { userName: (p as { user?: string }).user });
    case 'adminUsers': return adminUsers();
    case 'adminCategories': return adminCategories();
    case 'addCategory': return addCategory(p);
    case 'updateCategory': return updateCategory(p);
    case 'renameCategory': return renameCategory(p);
    case 'trash': return trash();
    case 'templates': return templates();
    case 'addTemplate': return addTemplate(p);
    case 'updateTemplate': return updateTemplate(p);
    case 'deleteTemplate': return deleteTemplate(p);
    case 'reorderTemplates': return reorderTemplates(p);
    case 'restoreExpense': return restoreExpense(p);
    case 'purgeExpense': return purgeExpense(p);
    case 'changePin': return changePin(p);
    default:
      // addUser, setPin and setUserActive need a secret key: not possible from the browser.
      throw new ApiError('BAD_REQUEST', `action not supported: ${action}`);
  }
}
