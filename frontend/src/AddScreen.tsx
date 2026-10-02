import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, call, newClientId } from './api';
import type { Session } from './auth';
import { invalidateDataCaches } from './cache';
import { getCategories, peekCategories } from './categories';
import { CategoryChips, ErrorBox, Loading } from './components';
import { markAction } from './debug';
import { dayLabel, formatEur, parsePrice, priceToInput, todayLocal } from './format';
import { IconAlert, IconCalendar, IconCheck } from './icons';
import { errorText } from './messages';
import { loadPending, savePending, type PendingExpense } from './pending';
import { store } from './storage';
import { TemplatesSheet } from './Templates';
import type { Category, Template } from './types';
import { useFetch } from './useFetch';

// What the strip says when an item could not be sent. Retrying is safe (same client_id).
function failureText(e: unknown): string {
  const transport = e instanceof ApiError && ['NETWORK', 'TIMEOUT', 'SERVER_ERROR'].includes(e.code);
  return transport ? 'Не успях да изпратя. „Опитай пак“ няма да го запише два пъти.' : errorText(e);
}

// `active` is false while another tab is shown: this screen stays mounted so unsaved
// fields and the pending strip survive tab switches.
export function AddScreen({ user, active }: { user: Session['user']; active: boolean }) {
  const lastKey = `lastCategory:${user.name}`;
  const [categories, setCategories] = useState<Category[] | null>(peekCategories);
  const [catError, setCatError] = useState('');
  const [category, setCategory] = useState<string | null>(() => {
    const last = store.get(lastKey);
    return peekCategories()?.some((c) => c.name === last) ? last : null;
  });
  const [price, setPrice] = useState('');
  const [item, setItem] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingExpense[]>(() => loadPending(user.name));
  const [manageOpen, setManageOpen] = useState(false);
  const templates = useFetch(() => call<Template[]>('templates'), [], { name: 'templates', match: '' });
  const priceRef = useRef<HTMLInputElement>(null);
  const sending = useRef(new Set<string>()); // requestIds being sent right now (no double sends)
  const timers = useRef<number[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

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
      .catch((e) => {
        // With a (possibly stale) list on screen a failed refresh is not worth an error.
        if (!keepList) setCatError(errorText(e));
      });
  }, [lastKey]);

  useEffect(() => {
    if (active) loadCategories(true);
  }, [active, loadCategories]);

  // This screen stays mounted: pick up template changes when it is shown again.
  const shownBefore = useRef(false);
  useEffect(() => {
    if (active && shownBefore.current) templates.refetch();
    if (active) shownBefore.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Fills the form from a template. Only the form changes: saving is a normal new expense.
  function applyTemplate(t: Template) {
    setItem(t.title);
    setPrice(t.amount === null ? '' : priceToInput(t.amount));
    setError(t.categoryActive ? '' : 'Категорията е изключена');
    if (t.categoryActive) setCategory(t.category);
    if (t.amount === null) priceRef.current?.focus();
  }

  useEffect(() => savePending(user.name, pending), [pending, user.name]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const patch = useCallback((rid: string, change: Partial<PendingExpense>) => {
    setPending((list) => list.map((p) => (p.rid === rid ? { ...p, ...change } : p)));
  }, []);

  // Sends one pending item in the background. call() retries network failures and timeouts
  // with the same client_id; only when that is exhausted does the item stay in the strip.
  const send = useCallback(async (p: PendingExpense) => {
    if (sending.current.has(p.rid)) return;
    if (!navigator.onLine) {
      patch(p.rid, { status: 'failed', error: 'Няма връзка. Ще опитам пак, когато се върне.' });
      return;
    }
    sending.current.add(p.rid);
    patch(p.rid, { status: 'sending', attempt: 0, error: undefined });
    try {
      await call('addExpense', { date: p.date, item: p.item, price: p.price, category: p.category, clientId: p.rid, forUser: user.name }, {
        onRetry: (n) => patch(p.rid, { attempt: n }),
      });
      invalidateDataCaches();
      patch(p.rid, { status: 'saved' });
      timers.current.push(window.setTimeout(() => setPending((l) => l.filter((x) => x.rid !== p.rid)), 2500));
    } catch (e) {
      invalidateDataCaches(); // it may have been executed even though we got an error
      patch(p.rid, { status: 'failed', error: failureText(e) });
    } finally {
      sending.current.delete(p.rid);
    }
  }, [patch]);

  // Back online: send what could not be sent (same client_id, so no duplicates).
  useEffect(() => {
    const onOnline = () => {
      pendingRef.current
        .filter((p) => p.status === 'failed')
        .forEach((p) => void send(p));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [send]);

  // Saving is instant: the form clears and the item goes to the strip; the send happens in the background.
  function save(e: FormEvent) {
    e.preventDefault();
    const amount = parsePrice(price);
    const text = item.trim();
    if (amount === null) return setError('Въведи валидна сума (над 0, до 2 цифри след запетаята).');
    if (!text) return setError('Въведи какво е.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Избери дата.');
    if (!category) return setError('Избери категория.');

    const p: PendingExpense = {
      rid: newClientId(),
      date,
      item: text,
      price: amount,
      category,
      createdAt: Date.now(),
      status: 'sending',
      attempt: 0,
    };
    store.set(lastKey, category);
    markAction('add:save');
    setPending((l) => [p, ...l]);
    setPrice('');
    setItem('');
    setError('');
    priceRef.current?.focus();
    void send(p);
  }

  const dateText = date === todayLocal() ? 'Днес' : /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayLabel(date) : 'Дата';

  return (
    <section className="page add">
      {pending.length > 0 && (
        <ul className="pending card" aria-label="Изпращане на разходи">
          {pending.map((p) => (
            <li key={p.rid} className={`pending-item ${p.status}`}>
              <div className="pending-line">
                <span className="pending-text">
                  <strong>{p.item}</strong> · {formatEur(p.price)}
                </span>
                {p.status === 'sending' && (
                  <span className="pending-state" role="status">
                    <span className="spinner" aria-hidden="true" /> {p.attempt > 0 ? 'Опитвам пак…' : 'Записвам…'}
                  </span>
                )}
                {p.status === 'saved' && (
                  <span className="pending-state ok" role="status">
                    <IconCheck size={18} /> Записано
                  </span>
                )}
                {p.status === 'failed' && (
                  <span className="pending-state bad" aria-hidden="true">
                    <IconAlert size={18} />
                  </span>
                )}
              </div>
              {p.status === 'failed' && (
                <>
                  <p className="error">{p.error}</p>
                  <div className="pending-actions">
                    <button className="secondary" onClick={() => void send(p)}>Опитай пак</button>
                    <button className="secondary" onClick={() => setPending((l) => l.filter((x) => x.rid !== p.rid))}>
                      Изтрий
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="filter-row" role="group" aria-label="Шаблони">
        {(templates.data ?? []).map((t) => (
          <button
            key={t.id}
            type="button"
            className="filter-chip"
            style={t.categoryActive ? undefined : { opacity: 0.5 }}
            onClick={() => applyTemplate(t)}
          >
            {t.title}
          </button>
        ))}
        <button type="button" className="filter-chip" onClick={() => setManageOpen(true)}>
          Шаблони
        </button>
      </div>

      <form onSubmit={save} noValidate>
        <div className="amount-field">
          <label htmlFor="price" className="sr-only">Сума (€)</label>
          <input
            id="price"
            ref={priceRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="0,00"
            style={{ width: `${Math.max(price.length, 4) + 0.5}ch` }}
            value={price}
            onChange={(e) => {
              if (/^\d*[.,]?\d{0,2}$/.test(e.target.value)) setPrice(e.target.value);
            }}
          />
          <span className="amount-currency" aria-hidden="true">€</span>
        </div>

        <label htmlFor="item" className="sr-only">Какво</label>
        <input
          id="item"
          type="text"
          maxLength={100}
          autoComplete="off"
          placeholder="Какво купи?"
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />

        <div className="meta-row">
          <label className="date-pill">
            <IconCalendar size={18} />
            <span>{dateText}</span>
            <input
              id="date"
              type="date"
              aria-label="Дата"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.(); // desktop browsers: open the picker on click
                } catch {
                  /* not allowed here: the native control still works */
                }
              }}
            />
          </label>
        </div>

        <span className="label" id="cat-label">Категория</span>
        {catError ? (
          <ErrorBox message={catError} onRetry={() => loadCategories()} />
        ) : categories === null ? (
          <Loading variant="chips" />
        ) : categories.length === 0 ? (
          <p className="muted">Няма активни категории.</p>
        ) : (
          <CategoryChips categories={categories} selected={category} onSelect={setCategory} labelledBy="cat-label" grid />
        )}

        <div className="save-bar">
          <p className="error" role="alert">{error}</p>
          <button type="submit" className="primary save">
            Запази
          </button>
        </div>
      </form>

      {manageOpen && <TemplatesSheet categories={categories ?? []} onClose={() => setManageOpen(false)} />}
    </section>
  );
}
