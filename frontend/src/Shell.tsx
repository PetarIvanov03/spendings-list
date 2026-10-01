import { useState, type ReactElement } from 'react';
import { useRetrying } from './api';
import type { Session } from './auth';
import { Sheet } from './components';
import { markAction } from './debug';
import { IconChart, IconGear, IconKey, IconList, IconLogout, IconMore, IconPlus, IconWifiOff, LogoMark } from './icons';
import { useOnline } from './online';
import { AddScreen } from './AddScreen';
import { AdminScreen } from './AdminScreen';
import { ChangePinSheet } from './ChangePin';
import { ListScreen } from './ListScreen';
import { SummaryScreen } from './SummaryScreen';

type Tab = 'add' | 'list' | 'summary' | 'admin';

const ICONS: Record<Tab, ReactElement> = {
  add: <IconPlus />,
  list: <IconList />,
  summary: <IconChart />,
  admin: <IconGear />,
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
  const retrying = useRetrying();
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
          <IconWifiOff size={18} />
          Няма връзка. Новите разходи се пазят и се изпращат, когато връзката се върне.
        </div>
      )}
      {retrying && online && (
        <div className="retrying" role="status">
          Опитвам пак…
        </div>
      )}
      <header className="topbar">
        <span className="brand">
          <LogoMark size={28} />
          <span className="who">{user.name}</span>
          {isAdmin && <span className="badge badge-admin">админ</span>}
        </span>
        <button className="icon-btn" aria-label="Меню" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          <IconMore />
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
            <span className="tab-icon">{ICONS[t.id]}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {menuOpen && (
        <Sheet title={user.name} onClose={() => setMenuOpen(false)}>
          <div className="menu-list">
            <button className="menu-item" onClick={() => { setMenuOpen(false); setPinOpen(true); }}>
              <IconKey /> Смяна на ПИН
            </button>
            <button className="menu-item" onClick={onLogout}>
              <IconLogout /> Изход
            </button>
          </div>
        </Sheet>
      )}
      {pinOpen && <ChangePinSheet user={user} onClose={() => setPinOpen(false)} onChanged={onPinChanged} />}
    </div>
  );
}
