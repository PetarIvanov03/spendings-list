import { useState, type ReactElement } from 'react';
import type { Session } from './auth';
import { Sheet } from './components';
import { markAction } from './debug';
import { useOnline } from './online';
import { AddScreen } from './AddScreen';
import { AdminScreen } from './AdminScreen';
import { ChangePinSheet } from './ChangePin';
import { ListScreen } from './ListScreen';
import { SummaryScreen } from './SummaryScreen';

type Tab = 'add' | 'list' | 'summary' | 'admin';

const ICONS: Record<Tab, ReactElement> = {
  add: <path d="M12 5v14M5 12h14" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  summary: <path d="M5 20V10M12 20V4M19 20v-7" />,
  admin: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />,
};

// Layout for a logged-in user: top bar, the active screen, bottom tab bar.
// Only the Add screen stays mounted (hidden) so its unsaved fields survive tab switches;
// the other screens load fresh data each time they open.
export function Shell({ user, onLogout, onPinChanged }: {
  user: Session['user'];
  onLogout: () => void;
  onPinChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('add');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const online = useOnline();
  const isAdmin = user.role === 'admin'; // cosmetic only: the server enforces roles

  const tabs: { id: Tab; label: string }[] = [
    { id: 'add', label: 'Добави' },
    { id: 'list', label: 'Списък' },
    { id: 'summary', label: 'Справка' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Админ' }] : []),
  ];

  return (
    <div className="shell">
      {!online && (
        <div className="offline" role="status">
          Няма връзка. Записването е изключено.
        </div>
      )}
      <header className="topbar">
        <span className="who">
          {user.name}
          {isAdmin && <span className="badge">админ</span>}
        </span>
        <button className="icon-btn" aria-label="Меню" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          ⋮
        </button>
      </header>

      <main className="content">
        <div hidden={tab !== 'add'}>
          <AddScreen user={user} active={tab === 'add'} />
        </div>
        {tab === 'list' && <ListScreen user={user} />}
        {tab === 'summary' && <SummaryScreen user={user} />}
        {tab === 'admin' && isAdmin && <AdminScreen user={user} />}
      </main>

      <nav className="tabbar" aria-label="Основна навигация">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? 'tab on' : 'tab'}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => { markAction(`tab:${t.id}`); setTab(t.id); }}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[t.id]}
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {menuOpen && (
        <Sheet title={user.name} onClose={() => setMenuOpen(false)}>
          <div className="menu-list">
            <button className="secondary" onClick={() => { setMenuOpen(false); setPinOpen(true); }}>
              Смяна на ПИН
            </button>
            <button className="secondary" onClick={onLogout}>
              Изход
            </button>
          </div>
        </Sheet>
      )}
      {pinOpen && <ChangePinSheet user={user} onClose={() => setPinOpen(false)} onChanged={onPinChanged} />}
    </div>
  );
}
