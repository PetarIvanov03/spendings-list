import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './api';
import type { Session } from './auth';
import { formatEur, textColorFor, todayLocal } from './format';
import { errorText } from './messages';
import { store } from './storage';

interface Category {
  name: string;
  color: string;
  order: number;
}

// Same rules as the server: > 0, < 100000, at most 2 decimals. Accepts comma or dot.
function parsePrice(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 100000 ? n : null;
}

export function AddScreen({ user, onLogout }: { user: Session['user']; onLogout: () => void }) {
  const lastKey = `lastCategory:${user.name}`;
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

  const loadCategories = useCallback(() => {
    setCategories(null);
    setCatError('');
    call<Category[]>('categories')
      .then((list) => {
        setCategories(list);
        const last = store.get(lastKey);
        setCategory((current) => current ?? (list.some((c) => c.name === last) ? last : null));
      })
      .catch((e) => setCatError(errorText(e)));
  }, [lastKey]);
  useEffect(loadCategories, [loadCategories]);
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
    <main className="page">
      <header className="bar">
        <span className="who">{user.name}</span>
        <button className="link" onClick={onLogout}>Изход</button>
      </header>

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
          <>
            <p className="error" role="alert">{catError}</p>
            <button type="button" className="secondary" onClick={loadCategories}>Опитай пак</button>
          </>
        ) : categories === null ? (
          <p className="muted">Зареждане…</p>
        ) : categories.length === 0 ? (
          <p className="muted">Няма активни категории.</p>
        ) : (
          <div className="chips" role="radiogroup" aria-labelledby="cat-label">
            {categories.map((c) => {
              const selected = c.name === category;
              return (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'chip selected' : 'chip'}
                  style={{ background: c.color, color: textColorFor(c.color) }}
                  onClick={() => setCategory(c.name)}
                >
                  {selected && '✓ '}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        <p className="error" role="alert">{error}</p>
        <button type="submit" className="primary save" disabled={busy}>
          {busy ? 'Записвам…' : 'Запази'}
        </button>
        <p className="saved" role="status">{saved && `Записано ✓ ${saved}`}</p>
      </form>
    </main>
  );
}
