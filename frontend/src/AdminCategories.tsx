import { useMemo, useState } from 'react';
import { call } from './api';
import { invalidateCategories } from './categories';
import { ColorPicker, ConfirmDialog, ErrorBox, Loading, Notice, Sheet } from './components';
import { textColorFor } from './format';
import { useOnline } from './online';
import { useToast } from './toast';
import type { AdminCategory } from './types';
import { useFetch } from './useFetch';
import { runWrite } from './write';

const byOrder = (a: AdminCategory, b: AdminCategory) => a.order - b.order;

function Chip({ name, color }: { name: string; color: string }) {
  return (
    <span className="cat-chip" style={{ background: color, color: textColorFor(color) }}>
      {name}
    </span>
  );
}

export function AdminCategories() {
  const toast = useToast();
  const online = useOnline();
  const cats = useFetch(() => call<AdminCategory[]>('adminCategories'), []);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Active first, then inactive; each group by its order.
  const sorted = useMemo(() => {
    const all = cats.data ?? [];
    return [...all.filter((c) => c.active).sort(byOrder), ...all.filter((c) => !c.active).sort(byOrder)];
  }, [cats.data]);

  // Any category change: drop the cached active list (the Add screen reloads it) and refetch.
  function changed(message: string, uncertain = false) {
    invalidateCategories();
    cats.refetch();
    setEditing(null);
    setAdding(false);
    if (uncertain) setNotice(message);
    else toast(message);
  }

  // Moves a category one step within its group by renumbering the whole list 1..n.
  // Calls run one after another; whatever the outcome we refetch to show the truth.
  async function move(c: AdminCategory, dir: -1 | 1) {
    const group = sorted.filter((x) => x.active === c.active);
    const i = group.findIndex((x) => x.name === c.name);
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    const full = c.active ? [...group, ...sorted.filter((x) => !x.active)] : [...sorted.filter((x) => x.active), ...group];

    setBusy(true);
    const r = await runWrite(async () => {
      for (let k = 0; k < full.length; k++) {
        if (full[k].order !== k + 1) await call('updateCategory', { name: full[k].name, order: k + 1 });
      }
    });
    setBusy(false);
    invalidateCategories();
    cats.refetch();
    if (!r.ok) setNotice(r.message);
  }

  return (
    <div>
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {cats.error && cats.data === null ? (
        <ErrorBox message={cats.error} onRetry={cats.refetch} />
      ) : cats.data === null ? (
        <Loading />
      ) : (
        <ul className="admin-list">
          {sorted.map((c) => {
            const group = sorted.filter((x) => x.active === c.active);
            const idx = group.findIndex((x) => x.name === c.name);
            return (
              <li key={c.name} className={c.active ? 'admin-row' : 'admin-row dim'}>
                <span className="admin-name">
                  <Chip name={c.name} color={c.color} />
                  {!c.active && <span className="badge">неактивна</span>}
                </span>
                <span className="row-actions">
                  <button className="icon-btn" aria-label={`Нагоре: ${c.name}`} disabled={busy || !online || idx === 0} onClick={() => void move(c, -1)}>
                    ▲
                  </button>
                  <button className="icon-btn" aria-label={`Надолу: ${c.name}`} disabled={busy || !online || idx === group.length - 1} onClick={() => void move(c, 1)}>
                    ▼
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => setEditing(c)}>
                    Промени
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <button className="primary save" disabled={busy || !online} onClick={() => setAdding(true)}>
        Нова категория
      </button>

      {editing && <CategorySheet cat={editing} onClose={() => setEditing(null)} onChanged={changed} />}
      {adding && <AddCategorySheet onClose={() => setAdding(false)} onChanged={changed} />}
    </div>
  );
}

function CategorySheet({ cat, onClose, onChanged }: {
  cat: AdminCategory;
  onClose: () => void;
  onChanged: (message: string, uncertain?: boolean) => void;
}) {
  const online = useOnline();
  const [color, setColor] = useState(cat.color);
  const [name, setName] = useState(cat.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'rename' | 'deactivate' | null>(null);
  const newName = name.trim();

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    const r = await runWrite(fn);
    if (r.ok) return onChanged(done);
    if (r.uncertain) return onChanged(r.message, true);
    setError(r.message);
    setBusy(false);
    setConfirm(null);
  }

  return (
    <Sheet title={cat.name} onClose={onClose}>
      <span className="label">Цвят</span>
      <ColorPicker value={color} onChange={setColor} />
      <button
        className="secondary wide"
        disabled={busy || !online || color.toLowerCase() === cat.color.toLowerCase()}
        onClick={() => void run(() => call('updateCategory', { name: cat.name, color }), 'Цветът е сменен ✓')}
      >
        Запази цвят
      </button>

      <label htmlFor="cat-name">Ново име</label>
      <input id="cat-name" type="text" maxLength={50} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        className="secondary wide"
        disabled={busy || !online || !newName || newName === cat.name}
        onClick={() => setConfirm('rename')}
      >
        Преименувай
      </button>

      <span className="label">Видимост</span>
      {cat.active ? (
        <button className="danger-outline" disabled={busy || !online} onClick={() => setConfirm('deactivate')}>
          Деактивирай
        </button>
      ) : (
        <button
          className="primary wide"
          disabled={busy || !online}
          onClick={() => void run(() => call('updateCategory', { name: cat.name, active: true }), 'Категорията е активна ✓')}
        >
          Активирай
        </button>
      )}

      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}

      {confirm === 'rename' && (
        <ConfirmDialog
          title="Преименуване"
          message={`„${cat.name}“ става „${newName}“. Всички съществуващи разходи с това име също ще бъдат обновени.`}
          confirmText="Преименувай"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => call('renameCategory', { oldName: cat.name, newName }), 'Категорията е преименувана ✓')}
        />
      )}
      {confirm === 'deactivate' && (
        <ConfirmDialog
          title="Деактивиране"
          message="Деактивираната категория изчезва от екрана „Добави“, но старите разходи я запазват."
          confirmText="Деактивирай"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => call('updateCategory', { name: cat.name, active: false }), 'Категорията е деактивирана ✓')}
        />
      )}
    </Sheet>
  );
}

function AddCategorySheet({ onClose, onChanged }: {
  onClose: () => void;
  onChanged: (message: string, uncertain?: boolean) => void;
}) {
  const online = useOnline();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#d9ead3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();

  async function save() {
    if (trimmed.length < 1 || trimmed.length > 50) return setError('Името трябва да е от 1 до 50 символа.');
    setBusy(true);
    setError('');
    const r = await runWrite(() => call('addCategory', { name: trimmed, color }));
    if (r.ok) return onChanged('Категорията е добавена ✓');
    if (r.uncertain) return onChanged(r.message, true);
    setError(r.message);
    setBusy(false);
  }

  return (
    <Sheet title="Нова категория" onClose={onClose}>
      <label htmlFor="new-cat">Име</label>
      <input id="new-cat" type="text" maxLength={50} autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Цвят</span>
      <ColorPicker value={color} onChange={setColor} />
      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
      <button className="primary save" disabled={busy || !online} onClick={() => void save()}>
        {busy ? 'Записвам…' : 'Добави'}
      </button>
    </Sheet>
  );
}
