import { useMemo, useState } from 'react';
import { call } from './api';
import { seesFamily, type Session } from './auth';
import { useCategories } from './categories';
import { CategoryTag, Empty, ErrorBox, Loading, MonthSwitcher, Notice, Refreshing, StaleNotice } from './components';
import { ExpenseSheet, type SheetOutcome } from './ExpenseSheet';
import { Dropdown, MultiDropdown } from './Dropdown';
import { currentMonth, dayLabel, formatEur, monthLabelShort, monthOptions, sumPrices } from './format';
import { useToast } from './toast';
import type { AdminUser, Expense } from './types';
import { useFetch } from './useFetch';

const NO_USER = '(без потребител)';

export function ListScreen({ user }: { user: Session['user'] }) {
  const family = seesFamily(user.role); // cosmetic: RLS decides which rows come back
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [who, setWho] = useState<string | null>(null); // admin/parent user filter, null = everyone
  const [cats, setCats] = useState<string[]>([]); // category filter, empty = all (admin/parent)
  const [editing, setEditing] = useState<Expense | null>(null);
  const [notice, setNotice] = useState('');

  const list = useFetch(
    () => call<Expense[]>('listExpenses', { month, ...(who ? { user: who } : {}) }),
    [month, who],
    { name: 'list', match: `${month}|${who ?? ''}` },
  );
  const categories = useCategories();
  const users = useFetch(
    () => (family ? call<AdminUser[]>('adminUsers') : Promise.resolve([])),
    [family],
    { name: 'adminUsers', match: '' },
  );

  const colors = useMemo(() => new Map((categories ?? []).map((c) => [c.name, c.color])), [categories]);
  const all = list.data ?? [];
  // Filters combine (AND): the member filter is applied by the server, the category one here.
  const rows = useMemo(() => (cats.length ? all.filter((r) => cats.includes(r.category)) : all), [all, cats]);
  const total = sumPrices(rows.map((r) => r.price));
  // Active categories, plus any inactive one that old expenses of this month still use.
  const categoryOptions = useMemo(() => {
    const names = (categories ?? []).map((c) => c.name);
    for (const r of all) if (r.category && !names.includes(r.category)) names.push(r.category);
    return names.map((n) => ({ value: n, label: n }));
  }, [categories, all]);
  const filtered = who !== null || cats.length > 0;

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

  // A parent only edits their own rows (RLS refuses the rest); the admin edits everything.
  const canEdit = (r: Expense) => user.role === 'admin' || r.user === user.name;

  const rowBody = (r: Expense) => (
    <>
      <span className="row-main">
        <span className="row-item">{r.item}</span>
        <span className="row-meta">
          <CategoryTag name={r.category} colors={colors} />
          {family && <span>{r.user || NO_USER}</span>}
        </span>
      </span>
      <span className="row-price">{formatEur(r.price)}</span>
    </>
  );

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
        {family ? (
          <div className="dd-row three">
            <Dropdown
              label="Човек"
              value={who}
              defaultValue={null}
              onChange={setWho}
              options={[{ value: null, label: 'Всички' }, ...(users.data ?? []).map((u) => ({ value: u.name, label: u.name }))]}
            />
            <Dropdown
              label="Месец"
              value={month}
              text={monthLabelShort(month)}
              defaultValue={currentMonth()}
              onChange={setMonth}
              options={monthOptions(month)}
            />
            <MultiDropdown label="Категория" options={categoryOptions} selected={cats} onChange={setCats} noun="категории" />
          </div>
        ) : (
          <>
            <MonthSwitcher month={month} onChange={setMonth} />
            <div className="total-line">
              <span>Общо за месеца</span>
              {list.data === null ? <span className="skeleton" style={{ width: 96, height: 24 }} /> : <strong>{formatEur(total)}</strong>}
            </div>
          </>
        )}
        <Refreshing show={list.refreshing} />
      </div>

      <StaleNotice show={!!list.error && list.data !== null} onRetry={list.refetch} />
      <Notice text={notice} onDismiss={() => setNotice('')} />

      {list.error && list.data === null ? (
        <ErrorBox message={list.error} onRetry={list.refetch} />
      ) : list.data === null ? (
        <Loading />
      ) : days.length === 0 ? (
        filtered ? (
          <Empty hint="Опитай с други филтри.">Няма разходи за избраните филтри.</Empty>
        ) : (
          <Empty hint="Добави първия разход от екрана „Добави“.">Няма разходи през този месец.</Empty>
        )
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
                  {canEdit(r) ? (
                    <button className="row" onClick={() => setEditing(r)}>{rowBody(r)}</button>
                  ) : (
                    <div className="row row-static">{rowBody(r)}</div>
                  )}
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
