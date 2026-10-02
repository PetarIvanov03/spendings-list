import type { Role } from './auth';

export interface Category {
  name: string;
  color: string;
  order: number;
}

export interface AdminCategory extends Category {
  active: boolean;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  item: string;
  price: number;
  category: string;
  user: string; // '' for legacy rows
  createdAt: string;
}

// A personal template for a repeating expense. `amount` null = ask every time.
export interface Template {
  id: string;
  title: string;
  category: string;
  categoryActive: boolean;
  amount: number | null;
  order: number;
}

export interface TrashExpense extends Expense {
  deletedAt: string; // ISO
}

export interface AdminUser {
  name: string;
  role: Role;
  active: boolean;
}

export interface SummaryData {
  total: number;
  byCategory: { category: string; total: number }[];
  byUser?: { user: string; total: number }[]; // adminSummary only
  byUserCategory?: { user: string; byCategory: { category: string; total: number }[] }[]; // adminSummary only
}
