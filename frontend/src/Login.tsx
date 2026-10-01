import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import { saveSession, type Session } from './auth';
import { markAction } from './debug';
import { errorText } from './messages';
import { PinPad } from './PinPad';

const MAX_PIN = 6; // admin 6 digits, members 4; role is unknown before login

export function Login({ onLogin, notice }: { onLogin: (s: Session) => void; notice?: string }) {
  const [names, setNames] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false); // synchronous guard against a double submit (key + click)

  const loadNames = useCallback(() => {
    setNames(null);
    setLoadError('');
    call<{ users: string[] }>('loginOptions')
      .then((r) => setNames(r.users))
      .catch((e) => setLoadError(errorText(e)));
  }, []);
  useEffect(loadNames, [loadNames]);

  // Explicit OK only: auto-submitting at 4 digits would burn an attempt for 6-digit admins.
  const canSubmit = !busy && (pin.length === 4 || pin.length === MAX_PIN);

  async function submit() {
    if (!name || !canSubmit || inFlight.current) return;
    markAction('login');
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const session = await call<Session>('login', { user: name, pin });
      saveSession(session);
      onLogin(session);
    } catch (e) {
      setError(errorText(e));
      setPin('');
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (!name) {
    return (
      <main className="page">
        <h1>Кой си ти?</h1>
        {notice && <p className="notice-ok" role="status">{notice}</p>}
        {loadError ? (
          <>
            <p className="error" role="alert">{loadError}</p>
            <button className="primary" onClick={loadNames}>Опитай пак</button>
          </>
        ) : names === null ? (
          <p className="muted">Зареждане…</p>
        ) : names.length === 0 ? (
          <p className="muted">Няма активни потребители.</p>
        ) : (
          <div className="chips">
            {names.map((n) => (
              <button key={n} className="chip name-chip" onClick={() => { setName(n); setError(''); }}>
                {n}
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="page">
      <button className="link" onClick={() => { setName(null); setPin(''); setError(''); }}>
        ← Смени
      </button>
      <h1>{name}</h1>
      <p className="muted">Въведи ПИН и натисни OK</p>
      <PinPad pin={pin} onChange={setPin} onSubmit={submit} maxLength={MAX_PIN} canSubmit={canSubmit} busy={busy} />
      <p className="error" role="alert">{error}</p>
    </main>
  );
}
