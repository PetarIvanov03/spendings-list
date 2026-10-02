import { useState } from 'react';
import { call } from './api';
import { ConfirmDialog, Empty, ErrorBox, Loading, Notice, Sheet } from './components';
import { formatEur } from './format';
import { useOnline } from './online';
import { useToast } from './toast';
import type { TrashExpense } from './types';
import { useFetch } from './useFetch';
import { runWrite } from './write';

const deletedLabel = (iso: string) =>
  new Date(iso).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Admin: deleted expenses (deleted_at is set). Restore, or delete for good.
export function AdminTrash() {
  const toast = useToast();
  const online = useOnline();
  const rows = useFetch(() => call<TrashExpense[]>('trash'), []);
  const [open, setOpen] = useState<TrashExpense | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    const r = await runWrite(fn);
    setBusy(false);
    if (r.ok || r.uncertain || r.code === 'NOT_FOUND') {
      setOpen(null);
      setConfirm(false);
      rows.refetch();
      if (r.ok) toast(done);
      else setNotice(r.message);
      return;
    }
    setError(r.message);
    setConfirm(false);
  }

  return (
    <div>
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {rows.error && rows.data === null ? (
        <ErrorBox message={rows.error} onRetry={rows.refetch} />
      ) : rows.data === null ? (
        <Loading />
      ) : rows.data.length === 0 ? (
        <Empty>Кошчето е празно.</Empty>
      ) : (
        <ul className="rows card">
          {rows.data.map((r) => (
            <li key={r.id}>
              <button className="row" onClick={() => { setError(''); setOpen(r); }}>
                <span className="row-main">
                  <span className="row-item">{r.item}</span>
                  <span className="row-meta">
                    <span>{r.date}</span>
                    <span>{r.category}</span>
                    <span>{r.user}</span>
                    <span>изтрит {deletedLabel(r.deletedAt)}</span>
                  </span>
                </span>
                <span className="row-price">{formatEur(r.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Sheet title={open.item} onClose={() => setOpen(null)}>
          <p>
            {formatEur(open.price)} · {open.category} · {open.user} · {open.date}
          </p>
          <p className="error" role="alert">{error}</p>
          {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
          <div className="sheet-actions">
            <button
              className="primary save"
              disabled={busy || !online}
              onClick={() => void run(() => call('restoreExpense', { id: open.id }), 'Възстановено ✓')}
            >
              Възстанови
            </button>
            <button className="danger-outline" disabled={busy || !online} onClick={() => setConfirm(true)}>
              Изтрий окончателно
            </button>
          </div>
          {confirm && (
            <ConfirmDialog
              title="Окончателно изтриване"
              message={`Да изтрия ли „${open.item}“ (${formatEur(open.price)}) завинаги? Не може да се върне.`}
              confirmText="Изтрий"
              danger
              busy={busy}
              onCancel={() => setConfirm(false)}
              onConfirm={() => void run(() => call('purgeExpense', { id: open.id }), 'Изтрито окончателно ✓')}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}
