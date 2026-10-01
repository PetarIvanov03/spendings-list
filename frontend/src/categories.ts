import { useEffect, useState } from 'react';
import { call } from './api';
import { dropCached, getCached, setCached } from './cache';
import type { Category } from './types';

// Active categories, kept in memory and in the persistent cache. They change rarely, so a
// cached list is used for up to 5 minutes; the bootstrap call at start refreshes it, and
// admin changes call invalidateCategories().
const MAX_AGE_MS = 5 * 60 * 1000;
let pending: Promise<Category[]> | null = null;
let generation = 0;

// Last known list (possibly from the previous session) for an instant first paint.
export function peekCategories(): Category[] | null {
  return getCached<Category[]>('categories', '')?.data ?? null;
}

export function getCategories(): Promise<Category[]> {
  const cached = getCached<Category[]>('categories', '');
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return Promise.resolve(cached.data);
  if (!pending) {
    const gen = generation;
    pending = call<Category[]>('categories')
      .then((list) => {
        if (gen === generation) setCached('categories', '', list);
        return list;
      })
      .finally(() => {
        if (gen === generation) pending = null;
      });
  }
  return pending;
}

// The start-up bootstrap request already carries the categories: anyone asking for them
// while it is in flight waits for it instead of sending a second request.
export function expectCategories(fromBootstrap: Promise<Category[]>): void {
  const gen = generation;
  pending = fromBootstrap
    .then((list) => {
      if (gen === generation) setCached('categories', '', list);
      return list;
    })
    .finally(() => {
      if (gen === generation) pending = null;
    });
  pending.catch(() => {}); // callers handle their own errors
}

export function invalidateCategories(): void {
  generation++;
  pending = null;
  dropCached('categories');
}

// For screens: the last known list at once, then the current one.
export function useCategories(): Category[] | null {
  const [list, setList] = useState<Category[] | null>(peekCategories);
  useEffect(() => {
    let alive = true;
    getCategories()
      .then((l) => alive && setList(l))
      .catch(() => {}); // the cached list (if any) stays
    return () => {
      alive = false;
    };
  }, []);
  return list;
}
