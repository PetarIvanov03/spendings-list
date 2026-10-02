import { useState, type FormEvent } from 'react';
import { call } from './api';
import { CategoryChips, ConfirmDialog, Sheet } from './components';
import { formatEur, NEUTRAL_COLOR, parsePrice, priceToInput } from './format';
import { useOnline } from './online';
import type { Category, Expense } from './types';
import { runWrite } from './write';
import { TemplateForm } from './Templates';

export type SheetOutcome =
  | { kind: 'saved' }
  | { kind: 'deleted' }
  | { kind: 'gone'; message: string } // NOT_FOUND: someone else already removed it
  | { kind: 'uncertain'; message: string }; // NETWORK / SERVER_ERROR: caller refetches and warns

// Edit or delete one expense. Sends only the fields that changed.
export function ExpenseSheet({ expense, categories, onClose, onDone }: {
  expense: Expense;
  categories: Category[]; // active categories
  onClose: () => void;
  onDone: (outcome: SheetOutcome) => void;
}) {
  const online = useOnline();
  const [price, setPrice] = useState(priceToInput(expense.price));
  const [item, setItem] = useState(expense.item);
  const [date, setDate] = useState(expense.date);
  const [category, setCategory] = useState(expense.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [asTemplate, setAsTemplate] = useState(false);

  // The row's current category stays selectable even if it is inactive or gone.
  const options = categories.some((c) => c.name === expense.category)
    ? categories
    : [...categories, { name: expense.category, color: NEUTRAL_COLOR, order: 999 }];

  async function send(fn: () => Promise<unknown>, ok: SheetOutcome) {
    setBusy(true);
    setError('');
    const r = await runWrite(fn);
    if (r.ok) return onDone(ok);
    if (r.uncertain) return onDone({ kind: 'uncertain', message: r.message });
    if (r.code === 'NOT_FOUND') return onDone({ kind: 'gone', message: r.message });
    setError(r.message);
    setBusy(false);
    setConfirmDelete(false);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const amount = parsePrice(price);
    const text = item.trim();
    if (amount === null) return setError('Въведи валидна цена (над 0, до 2 цифри след запетаята).');
    if (!text) return setError('Въведи описание.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Избери дата.');

    const patch: Record<string, unknown> = {};
    if (amount !== expense.price) patch.price = amount;
    if (text !== expense.item) patch.item = text;
    if (date !== expense.date) patch.date = date;
    if (category !== expense.category) patch.category = category;
    if (Object.keys(patch).length === 0) return onClose();

    void send(() => call('updateExpense', { id: expense.id, ...patch }), { kind: 'saved' });
  }

  if (asTemplate) {
    return (
      <Sheet title="Нов шаблон" onClose={() => setAsTemplate(false)}>
        <TemplateForm
          draft={{
            title: expense.item,
            category: categories.some((c) => c.name === expense.category) ? expense.category : null,
            amount: priceToInput(expense.price),
          }}
          categories={categories}
          onSaved={() => setAsTemplate(false)}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title="Редакция" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="amount-field">
          <label htmlFor="e-price" className="sr-only">Сума (€)</label>
          <input
            id="e-price"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            style={{ width: `${Math.max(price.length, 4) + 0.5}ch` }}
            value={price}
            onChange={(e) => {
              if (/^\d*[.,]?\d{0,2}$/.test(e.target.value)) setPrice(e.target.value);
            }}
          />
          <span className="amount-currency" aria-hidden="true">€</span>
        </div>
        <label htmlFor="e-item">Какво</label>
        <input id="e-item" type="text" maxLength={100} autoComplete="off" value={item} onChange={(e) => setItem(e.target.value)} />
        <label htmlFor="e-date">Дата</label>
        <input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="label" id="e-cat">Категория</span>
        <CategoryChips categories={options} selected={category} onSelect={setCategory} labelledBy="e-cat" grid />

        <p className="error" role="alert">{error}</p>
        {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
        <div className="sheet-actions">
          <button type="submit" className="primary save" disabled={busy || !online}>
            {busy ? 'Записвам…' : 'Запази'}
          </button>
          <button type="button" className="danger-outline" disabled={busy || !online} onClick={() => setConfirmDelete(true)}>
            Изтрий
          </button>
        </div>
        <button type="button" className="secondary wide" disabled={busy || !online} onClick={() => setAsTemplate(true)}>
          Запази като шаблон
        </button>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          title="Изтриване"
          message={`Да изтрия ли „${expense.item}“ (${formatEur(expense.price)})? Това не може да се върне.`}
          confirmText="Изтрий"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void send(() => call('deleteExpense', { id: expense.id }), { kind: 'deleted' })}
        />
      )}
    </Sheet>
  );
}
