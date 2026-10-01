import { useRef, useState, type FormEvent } from 'react';
import { ApiError, call } from './api';
import { saveSession, type Session } from './auth';
import { markAction } from './debug';
import { IconAlert, IconEye, IconEyeOff, LogoMark } from './icons';
import { errorText } from './messages';

// Login by typed name + PIN. The name is sent as typed: the server trims it, collapses
// spaces, normalizes it and matches it case-insensitively, and answers with the canonical
// spelling. Nothing here is stored or logged except the token the server returns.
export function Login({ onLogin, notice }: { onLogin: (s: Session) => void; notice?: string }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false); // last failure was a network problem
  const inFlight = useRef(false); // synchronous guard against a double submit (Enter + click)
  const pinRef = useRef<HTMLInputElement>(null);

  // No auto-submit: a 4-digit member PIN and a 6-digit admin PIN look the same until the end.
  const canSubmit = !busy && name.trim().length > 0 && /^\d{4,6}$/.test(pin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || inFlight.current) return;
    markAction('login');
    inFlight.current = true;
    setBusy(true);
    setError('');
    setRetry(false);
    try {
      const session = await call<Session>('login', { user: name, pin });
      saveSession(session);
      onLogin(session);
    } catch (err) {
      const network = err instanceof ApiError && ['NETWORK', 'TIMEOUT', 'SERVER_ERROR'].includes(err.code);
      setError(errorText(err));
      setRetry(network);
      if (!network) {
        setPin(''); // a wrong PIN is cleared, the name stays
        pinRef.current?.focus();
      }
      setBusy(false);
      inFlight.current = false;
    }
  }

  return (
    <main className="login">
      <div className="login-brand">
        <LogoMark size={48} />
        <div>
          <h1>Разходи</h1>
          <p>Влез с твоето име и ПИН</p>
        </div>
      </div>

      {notice && <p className="notice-ok" role="status">{notice}</p>}

      <form onSubmit={submit} noValidate>
        <label htmlFor="login-name">Име</label>
        <input
          id="login-name"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // "next": go to the PIN field, do not submit
              pinRef.current?.focus();
            }
          }}
        />

        <label htmlFor="login-pin">ПИН</label>
        <div className="field">
          <input
            id="login-pin"
            ref={pinRef}
            name="password"
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="current-password"
            maxLength={6}
            enterKeyHint="go"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button
            type="button"
            className="icon-btn toggle"
            aria-label={showPin ? 'Скрий ПИН' : 'Покажи ПИН'}
            aria-pressed={showPin}
            onClick={() => setShowPin((v) => !v)}
          >
            {showPin ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>

        <p className="form-error" role="alert">
          {error && (
            <>
              <IconAlert size={18} />
              <span>{error}</span>
            </>
          )}
        </p>

        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy ? 'Влизане…' : retry ? 'Опитай пак' : 'Вход'}
        </button>
      </form>
    </main>
  );
}
