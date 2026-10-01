import { useState } from 'react';
import { call } from './api';
import { pinLength, type Session } from './auth';
import { ConfirmDialog, ErrorBox, Loading, Notice, Sheet } from './components';
import { useOnline } from './online';
import { PinPad } from './PinPad';
import { useToast } from './toast';
import type { AdminUser } from './types';
import { useFetch } from './useFetch';
import { runWrite } from './write';

export function AdminUsers({ me }: { me: Session['user'] }) {
  const toast = useToast();
  const online = useOnline();
  const users = useFetch(() => call<AdminUser[]>('adminUsers'), []);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  // Any user change: refetch the list. A failed or uncertain write also refetches.
  function changed(message: string, uncertain = false) {
    users.refetch();
    setSelected(null);
    setAdding(false);
    if (uncertain) setNotice(message);
    else toast(message);
  }

  function renderRow(u: AdminUser) {
    return (
      <li key={u.name} className={u.active ? 'admin-row' : 'admin-row dim'}>
        <span className="admin-name">
          <strong>{u.name}</strong>
          <span className={u.role === 'admin' ? 'badge badge-admin' : 'badge'}>{u.role === 'admin' ? 'админ' : 'член'}</span>
          <span className={u.active ? 'badge badge-ok' : 'badge badge-off'}>{u.active ? 'активен' : 'неактивен'}</span>
        </span>
        <button className="secondary" onClick={() => setSelected(u)}>
          Управление
        </button>
      </li>
    );
  }

  return (
    <div>
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {users.error && users.data === null ? (
        <ErrorBox message={users.error} onRetry={users.refetch} />
      ) : users.data === null ? (
        <Loading />
      ) : (
        <>
          <h3 className="section-title">Активни</h3>
          <ul className="admin-list card">{users.data.filter((u) => u.active).map(renderRow)}</ul>
          {users.data.some((u) => !u.active) && (
            <>
              <h3 className="section-title">Неактивни</h3>
              <ul className="admin-list card">{users.data.filter((u) => !u.active).map(renderRow)}</ul>
            </>
          )}
        </>
      )}
      <button className="primary save" disabled={!online} onClick={() => setAdding(true)}>
        Добави човек
      </button>

      {selected && <UserSheet user={selected} me={me} onClose={() => setSelected(null)} onChanged={changed} />}
      {adding && <AddUserSheet onClose={() => setAdding(false)} onChanged={changed} />}
    </div>
  );
}

function UserSheet({ user, me, onClose, onChanged }: {
  user: AdminUser;
  me: Session['user'];
  onClose: () => void;
  onChanged: (message: string, uncertain?: boolean) => void;
}) {
  const online = useOnline();
  const [mode, setMode] = useState<'menu' | 'pin'>('menu');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const length = pinLength(user.role);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    const r = await runWrite(fn);
    if (r.ok) return onChanged(done);
    if (r.uncertain) return onChanged(r.message, true);
    setError(r.message);
    setBusy(false);
    setConfirmOff(false);
    setPin('');
  }

  if (mode === 'pin') {
    return (
      <Sheet title={`ПИН за ${user.name}`} onClose={onClose}>
        <p className="muted">Нов ПИН: {length} цифри. Натисни „Запази“.</p>
        {user.name === me.name && <p className="muted">След смяната ще трябва да влезеш отново.</p>}
        <PinPad
          pin={pin}
          onChange={setPin}
          maxLength={length}
          dots={length}
          canSubmit={pin.length === length && online && !busy}
          busy={busy}
          okLabel="Запази"
          onSubmit={() => void run(() => call('setPin', { user: user.name, pin }), 'ПИН-ът е сменен ✓')}
        />
        <p className="error" role="alert">{error}</p>
        <button className="link" onClick={() => { setMode('menu'); setPin(''); setError(''); }}>
          ← Назад
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title={user.name} onClose={onClose}>
      <div className="menu-list">
        <button className="secondary" disabled={!online} onClick={() => setMode('pin')}>
          Смени ПИН
        </button>
        {user.active ? (
          <button className="danger-outline" disabled={busy || !online} onClick={() => setConfirmOff(true)}>
            Деактивирай
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !online}
            onClick={() => void run(() => call('setUserActive', { name: user.name, active: true }), 'Човекът е активен ✓')}
          >
            Активирай
          </button>
        )}
      </div>
      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}

      {confirmOff && (
        <ConfirmDialog
          title="Деактивиране"
          message={`${user.name} няма да може да влиза. Разходите му се запазват.`}
          confirmText="Деактивирай"
          danger
          busy={busy}
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => void run(() => call('setUserActive', { name: user.name, active: false }), 'Човекът е деактивиран ✓')}
        />
      )}
    </Sheet>
  );
}

function AddUserSheet({ onClose, onChanged }: {
  onClose: () => void;
  onChanged: (message: string, uncertain?: boolean) => void;
}) {
  const online = useOnline();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();

  async function add() {
    setBusy(true);
    setError('');
    const r = await runWrite(() => call('addUser', { name: trimmed, pin }));
    if (r.ok) return onChanged('Човекът е добавен ✓');
    if (r.uncertain) return onChanged(r.message, true);
    setError(r.message);
    setBusy(false);
    setPin('');
  }

  return (
    <Sheet title="Добави човек" onClose={onClose}>
      <label htmlFor="new-user">Име</label>
      <input id="new-user" type="text" maxLength={50} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">ПИН (4 цифри)</span>
      <PinPad
        pin={pin}
        onChange={setPin}
        maxLength={4}
        dots={4}
        canSubmit={trimmed.length > 0 && pin.length === 4 && online && !busy}
        busy={busy}
        okLabel="Добави"
        onSubmit={() => void add()}
      />
      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
    </Sheet>
  );
}
