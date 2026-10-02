import { useState, type FormEvent } from 'react';
import { call } from './api';
import { CategoryChips, ConfirmDialog, Empty, ErrorBox, Loading, Notice, Sheet } from './components';
import { formatEur, parsePrice, priceToInput } from './format';
import { IconArrowDown, IconArrowUp, IconEdit } from './icons';
import { useOnline } from './online';
import { useToast } from './toast';
import type { Category, Template } from './types';
import { useFetch } from './useFetch';
import { runWrite } from './write';

export interface TemplateDraft {
  id?: string; // missing = new template
  title: string;
  category: string | null;
  amount: string; // as typed; '' = no amount
}

const draftFromTemplate = (t: Template): TemplateDraft => ({
  id: t.id,
  title: t.title,
  category: t.categoryActive ? t.category : null,
  amount: t.amount === null ? '' : priceToInput(t.amount),
});

// Form for one template. The parent puts it inside a Sheet and decides what happens after.
export function TemplateForm({ draft, categories, onSaved, onDeleted }: {
  draft: TemplateDraft;
  categories: Category[]; // active ones
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const online = useOnline();
  const toast = useToast();
  const [title, setTitle] = useState(draft.title);
  const [category, setCategory] = useState(draft.category);
  const [amount, setAmount] = useState(draft.amount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = title.trim();
    const value = amount.trim() === '' ? null : parsePrice(amount);
    if (text.length < 1 || text.length > 100) return setError('Описанието трябва да е от 1 до 100 символа.');
    if (amount.trim() !== '' && value === null) return setError('Невалидна сума (над 0, до 2 цифри след запетаята).');
    if (!category) return setError('Избери категория.');
    setBusy(true);
    setError('');
    const payload = { title: text, category, amount: value };
    const r = await runWrite(() =>
      draft.id ? call('updateTemplate', { id: draft.id, ...payload }) : call('addTemplate', payload),
    );
    setBusy(false);
    if (r.ok) {
      toast('Шаблонът е записан ✓');
      return onSaved();
    }
    setError(r.message);
  }

  async function remove() {
    setBusy(true);
    const r = await runWrite(() => call('deleteTemplate', { id: draft.id }));
    setBusy(false);
    setConfirmDelete(false);
    if (r.ok || r.code === 'NOT_FOUND') {
      toast('Шаблонът е изтрит ✓');
      return onDeleted?.();
    }
    setError(r.message);
  }

  return (
    <form onSubmit={save} noValidate>
      <label htmlFor="t-title">Описание</label>
      <input id="t-title" type="text" maxLength={100} autoComplete="off" autoFocus={!draft.title} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="t-amount">Сума (€), по избор</label>
      <input
        id="t-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
        value={amount}
        onChange={(e) => {
          if (/^\d*[.,]?\d{0,2}$/.test(e.target.value)) setAmount(e.target.value);
        }}
      />
      <span className="label" id="t-cat">Категория</span>
      <CategoryChips categories={categories} selected={category} onSelect={setCategory} labelledBy="t-cat" grid />

      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
      <div className="sheet-actions">
        <button type="submit" className="primary save" disabled={busy || !online}>
          {busy ? 'Записвам…' : 'Запази'}
        </button>
        {draft.id && (
          <button type="button" className="danger-outline" disabled={busy || !online} onClick={() => setConfirmDelete(true)}>
            Изтрий
          </button>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Изтриване на шаблон"
          message={`Да изтрия ли шаблона „${draft.title}“? Това не може да се върне.`}
          confirmText="Изтрий"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </form>
  );
}

// Manage the user's templates: list, add, edit, delete, reorder.
export function TemplatesSheet({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const online = useOnline();
  const list = useFetch(() => call<Template[]>('templates'), [], { name: 'templates', match: '' });
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const items = list.data ?? [];

  // Renumber 1..n after swapping two neighbours; only changed rows are sent.
  async function move(i: number, dir: -1 | 1) {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    const orders = next.flatMap((t, k) => (t.order !== k + 1 ? [{ id: t.id, order: k + 1 }] : []));
    setBusy(true);
    const r = await runWrite(() => call('reorderTemplates', { orders }));
    setBusy(false);
    list.refetch();
    if (!r.ok) setNotice(r.message);
  }

  if (editing) {
    const back = () => {
      setEditing(null);
      list.refetch();
    };
    return (
      <Sheet title={editing.id ? 'Шаблон' : 'Нов шаблон'} onClose={() => setEditing(null)}>
        <TemplateForm draft={editing} categories={categories} onSaved={back} onDeleted={back} />
      </Sheet>
    );
  }

  return (
    <Sheet title="Шаблони" onClose={onClose}>
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {list.error && list.data === null ? (
        <ErrorBox message={list.error} onRetry={list.refetch} />
      ) : list.data === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty hint="Например наем или абонамент.">Нямаш шаблони.</Empty>
      ) : (
        <ul className="admin-list card">
          {items.map((t, i) => (
            <li key={t.id} className={t.categoryActive ? 'admin-row' : 'admin-row dim'}>
              <span className="admin-name">
                <strong>{t.title}</strong>
                <span className="muted">
                  {t.category} · {t.amount === null ? '—' : formatEur(t.amount)}
                </span>
              </span>
              <span className="row-actions">
                <button className="icon-btn" aria-label={`Нагоре: ${t.title}`} disabled={busy || !online || i === 0} onClick={() => void move(i, -1)}>
                  <IconArrowUp size={20} />
                </button>
                <button className="icon-btn" aria-label={`Надолу: ${t.title}`} disabled={busy || !online || i === items.length - 1} onClick={() => void move(i, 1)}>
                  <IconArrowDown size={20} />
                </button>
                <button className="icon-btn" aria-label={`Промени: ${t.title}`} disabled={busy} onClick={() => setEditing(draftFromTemplate(t))}>
                  <IconEdit size={20} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button className="primary save" disabled={busy || !online} onClick={() => setEditing({ title: '', category: null, amount: '' })}>
        Нов шаблон
      </button>
    </Sheet>
  );
}
