import { call } from './api';
import { loadSession, saveSession, type Session } from './auth';
import { setCached } from './cache';
import { expectCategories } from './categories';
import { markAction } from './debug';
import { currentMonth } from './format';
import type { Category, Expense } from './types';

interface BootstrapData {
  me: Session['user'];
  categories: Category[];
  expenses: Expense[];
}

// One request on app start (and right after login) instead of me + categories + list:
// it validates the token, and fills the categories and the current month's list caches.
// Screens that open meanwhile wait for it (see expectCategories) rather than ask again.
export function runBootstrap(): void {
  if (!loadSession()) return;
  const month = currentMonth();
  markAction('start');
  const request = call<BootstrapData>('bootstrap', { month });
  expectCategories(request.then((d) => d.categories));
  request
    .then((d) => {
      setCached('list', `${month}|`, d.expenses);
      const stored = loadSession();
      if (stored && (stored.user.role !== d.me.role || stored.user.name !== d.me.name)) {
        saveSession({ ...stored, user: d.me });
      }
    })
    .catch(() => {
      // UNAUTHORIZED is handled inside call(); on network errors the cached data stays.
    });
}
