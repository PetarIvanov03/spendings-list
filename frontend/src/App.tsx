import { useCallback, useEffect, useState } from 'react';
import { ApiError, call, setUnauthorizedHandler } from './api';
import { clearSession, loadSession, saveSession, type Session } from './auth';
import { errorText } from './messages';
import { AddScreen } from './AddScreen';
import { Login } from './Login';

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [checking, setChecking] = useState(session !== null);
  const [checkError, setCheckError] = useState('');

  // call() clears the token on UNAUTHORIZED and tells us to show the login screen.
  useEffect(() => setUnauthorizedHandler(() => setSession(null)), []);

  // A stored token is only trusted after the server accepts it.
  const validate = useCallback(() => {
    if (!loadSession()) {
      setSession(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    setCheckError('');
    call<Session['user']>('me')
      .then((user) => {
        const stored = loadSession();
        if (stored) saveSession({ ...stored, user });
        setSession((s) => s && { ...s, user });
        setChecking(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'UNAUTHORIZED') setSession(null);
        else setCheckError(errorText(e));
        setChecking(false);
      });
  }, []);

  useEffect(validate, [validate]);

  function logout() {
    clearSession();
    setSession(null);
  }

  if (!session) return <Login onLogin={setSession} />;
  if (checking) return <main className="page center">Зареждане…</main>;
  if (checkError) {
    return (
      <main className="page center">
        <p className="error" role="alert">{checkError}</p>
        <button className="primary" onClick={validate}>Опитай пак</button>
        <button className="link" onClick={logout}>Към вход</button>
      </main>
    );
  }
  return <AddScreen user={session.user} onLogout={logout} />;
}
