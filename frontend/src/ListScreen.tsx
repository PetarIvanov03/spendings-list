import { useMemo, useState } from 'react';
import { call } from './api';
import type { Session } from './auth';
import { useCategories } from './categories';
import { CategoryTag, ChipRow, Empty, ErrorBox, Loading, MonthSwitcher, Notice, Refreshing, StaleNotice } from './components';
import { ExpenseSheet, type SheetOutcome } from './ExpenseSheet';
import { currentMonth, dayLabel, formatEur, sumPrices } from './format';
import { useToast } from './toast';
import type { AdminUser, Expense } from './types';
import { useFetch } from './useFetch';

const NO_USER = '(без потребител)';

export function ListScreen({ user }: { user: Session['user'] }) {
  const isAdmin = user.role === 'admin'; // cosmetic: the server filters members' rows anyway
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [who, setWho] = useState<string | null>(null); // admin user filter, null = everyone
  const [editing, setEditing] = useState<Expense | null>(null);
  const [notice, setNotice] = useState('');

  const list = useFetch(
    () => call<Expense[]>('listExpenses', { month, ...(who ? { user: who } : {}) }),
    [month, who],
    { name: 'list', match: `${month}|${who ?? ''}` },
  );
  const categories = useCategories();
  const users = useFetch(
    () => (isAdmin ? call<AdminUser[]>('adminUsers') : Promise.resolve([])),
    [isAdmin],
    { name: 'adminUsers', match: '' },
  );

  const colors = useMemo(() => new Map((categories ?? []).map((c) => [c.name, c.color])), [categories]);
  const rows = list.data ?? [];
  const total = sumPrices(rows.map((r) => r.price));

  // Group by day, keeping the server's newest-first order.
  const days = useMemo(() => {
    const groups: { date: string; rows: Expense[] }[] = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else groups.push({ date: r.date, rows: [r] });
    }
    return groups;
  }, [rows]);

  function onDone(outcome: SheetOutcome) {
    setEditing(null);
    list.refetch(); // always show the server's truth afterwards
    if (outcome.kind === 'saved') toast('Записано ✓');
    else if (outcome.kind === 'deleted') toast('Изтрито ✓');
    else setNotice(outcome.message);
  }

  return (
    <section className="page">
      <div className="list-head">
        <MonthSwitcher month={month} onChange={setMonth} />
        <div className="total-line">
          <span>Общо за месеца</span>
          {list.data === null ? <span className="skeleton" style={{ width: 96, height: 24 }} /> : <strong>{formatEur(total)}</strong>}
        </div>
        <Refreshing show={list.refreshing} />
      </div>

      {isAdmin && (
        <ChipRow
          segmented
          label="Филтър по човек"
          value={who}
          onChange={setWho}
          items={[{ value: null, label: 'Всички' }, ...(users.data ?? []).map((u) => ({ value: u.name, label: u.name }))]}
        />
      )}
      <StaleNotice show={!!list.error && list.data !== null} onRetry={list.refetch} />
      <Notice text={notice} onDismiss={() => setNotice('')} />

      {list.error && list.data === null ? (
        <ErrorBox message={list.error} onRetry={list.refetch} />
      ) : list.data === null ? (
        <Loading />
      ) : days.length === 0 ? (
        <Empty hint="Добави първия разход от екрана „Добави“.">Няма разходи през този месец.</Empty>
      ) : (
        days.map((day) => (
          <div key={day.date} className="day">
            <h3 className="day-head">
              <span>{dayLabel(day.date)}</span>
              <span>{formatEur(sumPrices(day.rows.map((r) => r.price)))}</span>
            </h3>
            <ul className="rows card">
              {day.rows.map((r) => (
                <li key={r.id}>
                  <button className="row" onClick={() => setEditing(r)}>
                    <span className="row-main">
                      <span className="row-item">{r.item}</span>
                      <span className="row-meta">
                        <CategoryTag name={r.category} colors={colors} />
                        {isAdmin && <span>{r.user || NO_USER}</span>}
                      </span>
                    </span>
                    <span className="row-price">{formatEur(r.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {editing && (
        <ExpenseSheet
          expense={editing}
          categories={categories ?? []}
          onClose={() => setEditing(null)}
          onDone={onDone}
        />
      )}
    </section>
  );
}
