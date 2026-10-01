import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import { saveSession, type Session } from './auth';
import { errorText } from './messages';

const MAX_PIN = 6; // admin 6 digits, members 4; role is unknown before login
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
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

  const press = (key: string) => {
    if (busy) return;
    if (key === 'back') setPin((p) => p.slice(0, -1));
    else if (key === 'ok') void submit();
    else setPin((p) => (p.length < MAX_PIN ? p + key : p));
  };

  // Physical keyboard on desktop.
  useEffect(() => {
    if (!name) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!name) {
    return (
      <main className="page">
        <h1>Кой си ти?</h1>
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

  const dots = Math.max(4, pin.length);
  return (
    <main className="page">
      <button className="link" onClick={() => { setName(null); setPin(''); setError(''); }}>
        ← Смени
      </button>
      <h1>{name}</h1>
      <p className="muted">Въведи ПИН и натисни OK</p>
      <div className="pin-dots" aria-label={`Въведени цифри: ${pin.length}`}>
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
        ))}
      </div>
      <p className="error" role="alert">{error}</p>
      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === 'ok' ? 'key key-ok' : 'key'}
            disabled={k === 'ok' ? !canSubmit : busy}
            aria-label={k === 'back' ? 'Изтрий' : undefined}
            onClick={() => press(k)}
          >
            {k === 'back' ? '⌫' : k === 'ok' ? (busy ? '…' : 'OK') : k}
          </button>
        ))}
      </div>
    </main>
  );
}
