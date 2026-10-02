import { useEffect, useState } from 'react';
import { setUnauthorizedHandler } from './api';
import { clearSession, loadSession, type Session } from './auth';
import { runBootstrap } from './bootstrap';
import { clearAllCached } from './cache';
import { invalidateCategories } from './categories';
import { OnlineProvider } from './online';
import { ToastProvider } from './toast';
import { Login } from './Login';
import { signOut } from './supabase';
import { Shell } from './Shell';

export default function App() {
  return (
    <OnlineProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </OnlineProvider>
  );
}

// Everything cached from the server is dropped on logout and on UNAUTHORIZED.
// (Unsent expenses are not cache: they stay, per user, until they are sent or deleted.)
function forgetServerData() {
  clearAllCached();
  invalidateCategories();
  void signOut();
}

function Root() {
  // A stored session is trusted for the first paint. The bootstrap request started in
  // main.tsx (or at login) validates it; UNAUTHORIZED then sends us back to the login screen.
  const [session, setSession] = useState<Session | null>(loadSession);
  const [loginNotice, setLoginNotice] = useState('');

  // call() clears the token on UNAUTHORIZED and tells us to show the login screen.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        forgetServerData();
        setSession(null);
      }),
    [],
  );

  function logout(notice = '') {
    clearSession();
    forgetServerData();
    setLoginNotice(notice);
    setSession(null);
  }

  if (!session) {
    return (
      <Login
        notice={loginNotice}
        onLogin={(s) => {
          setLoginNotice('');
          runBootstrap(); // one request fills the categories and the first list
          setSession(s);
        }}
      />
    );
  }
  return (
    <Shell
      user={session.user}
      onLogout={() => logout()}
      onPinChanged={() => logout('ПИН-ът е сменен, влез отново.')}
    />
  );
}
