import { call } from './api';
import type { Category } from './types';

// In-memory cache of the active categories. Admin changes call invalidateCategories().
let cache: Category[] | null = null;
let pending: Promise<Category[]> | null = null;
let generation = 0;

export function getCategories(): Promise<Category[]> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    const gen = generation;
    pending = call<Category[]>('categories')
      .then((list) => {
        if (gen === generation) cache = list;
        return list;
      })
      .finally(() => {
        if (gen === generation) pending = null;
      });
  }
  return pending;
}

export function invalidateCategories(): void {
  generation++;
  cache = null;
  pending = null;
}
