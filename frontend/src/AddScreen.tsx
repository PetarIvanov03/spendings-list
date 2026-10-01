import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './api';
import type { Session } from './auth';
import { getCategories } from './categories';
import { CategoryChips, ErrorBox, Loading } from './components';
import { formatEur, parsePrice, todayLocal } from './format';
import { errorText } from './messages';
import { useOnline } from './online';
import { store } from './storage';
import type { Category } from './types';

// `active` is false while another tab is shown: this screen stays mounted so unsaved
// fields survive tab switches, and refreshes its categories when it becomes visible again.
export function AddScreen({ user, active }: { user: Session['user']; active: boolean }) {
  const lastKey = `lastCategory:${user.name}`;
  const online = useOnline();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [catError, setCatError] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [item, setItem] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(''); // formatted amount of the last save, '' = hidden
  const priceRef = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const inFlight = useRef(false); // synchronous guard against double submits

  const loadCategories = useCallback((keepList = false) => {
    if (!keepList) setCategories(null);
    setCatError('');
    getCategories()
      .then((list) => {
        setCategories(list);
        const last = store.get(lastKey);
        // Keep the selection if it still exists, else fall back to the last used one.
        setCategory((current) => {
          if (current && list.some((c) => c.name === current)) return current;
          return list.some((c) => c.name === last) ? last : null;
        });
      })
      .catch((e) => setCatError(errorText(e)));
  }, [lastKey]);

  useEffect(() => {
    if (active) loadCategories(true);
  }, [active, loadCategories]);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlight.current) return;

    const amount = parsePrice(price);
    const text = item.trim();
    if (amount === null) return setError('Въведи валидна цена (над 0, до 2 цифри след запетаята).');
    if (!text) return setError('Въведи описание.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Избери дата.');
    if (!category) return setError('Избери категория.');

    inFlight.current = true;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await call('addExpense', { date, item: text, price: amount, category });
      store.set(lastKey, category);
      setPrice('');
      setItem('');
      setSaved(formatEur(amount));
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(''), 3000);
      priceRef.current?.focus();
    } catch (err) {
      // No automatic retry: the request may have been executed even if we got an error.
      setError(errorText(err, true));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <form onSubmit={save} noValidate>
        <label htmlFor="price">Цена (€)</label>
        <input
          id="price"
          ref={priceRef}
          className="price-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0,00"
          value={price}
          onChange={(e) => {
            if (/^\d*[.,]?\d{0,2}$/.test(e.target.value)) setPrice(e.target.value);
          }}
        />

        <label htmlFor="item">Какво</label>
        <input
          id="item"
          type="text"
          maxLength={100}
          autoComplete="off"
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />

        <label htmlFor="date">Дата</label>
        <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <span className="label" id="cat-label">Категория</span>
        {catError ? (
          <ErrorBox message={catError} onRetry={() => loadCategories()} />
        ) : categories === null ? (
          <Loading />
        ) : categories.length === 0 ? (
          <p className="muted">Няма активни категории.</p>
        ) : (
          <CategoryChips categories={categories} selected={category} onSelect={setCategory} labelledBy="cat-label" />
        )}

        <p className="error" role="alert">{error}</p>
        <button type="submit" className="primary save" disabled={busy || !online}>
          {busy ? 'Записвам…' : 'Запази'}
        </button>
        {!online && <p className="muted center-text">Няма връзка — записването е изключено.</p>}
        <p className="saved" role="status">{saved && `Записано ✓ ${saved}`}</p>
      </form>
    </section>
  );
}
