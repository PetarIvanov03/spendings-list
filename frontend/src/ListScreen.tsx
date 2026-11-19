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

// Type filter: null = both, else only personal / only family expenses.
type Kind = 'personal' | 'family' | null;
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: null, label: 'Лични и семейни' },
  { value: 'personal', label: 'Само лични' },
  { value: 'family', label: 'Само семейни' },
];

export function ListScreen({ user }: { user: Session['user'] }) {
  const family = seesFamily(user.role); // cosmetic: RLS decides which rows come back
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [who, setWho] = useState<string | null>(family ? user.name : null); // admin/parent user filter: starts as yourself, null = everyone
  const [cats, setCats] = useState<string[]>([]); // category filter, empty = all (admin/parent)
  const [kind, setKind] = useState<Kind>(null);
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
  // Filters combine (AND): the member filter is applied by the server, category and type here.
  const rows = useMemo(
    () =>
      all.filter(
        (r) => (cats.length === 0 || cats.includes(r.category)) && (kind === null || (kind === 'family') === (r.family === true)),
      ),
    [all, cats, kind],
  );
  const total = sumPrices(rows.map((r) => r.price));
  // Active categories, plus any inactive one that old expenses of this month still use.
  const categoryOptions = useMemo(() => {
    const names = (categories ?? []).map((c) => c.name);
    for (const r of all) if (r.category && !names.includes(r.category)) names.push(r.category);
    return names.map((n) => ({ value: n, label: n }));
  }, [categories, all]);
  const filtered = who !== (family ? user.name : null) || cats.length > 0 || kind !== null;
  const kindDropdown = (
    <Dropdown
      label="Тип"
      value={kind}
      // short closed labels: they must fit a 360px phone (half a row, or next to the total)
      text={kind === 'family' ? 'Семейни' : kind === 'personal' ? 'Лични' : 'Тип: всички'}
      defaultValue={null}
      onChange={setKind}
      options={KIND_OPTIONS}
    />
  );
  const totalLine = (
    <div className="total-line">
      <span>Общо</span>
      {list.data === null ? <span className="skeleton" style={{ width: 96, height: 24 }} /> : <strong>{formatEur(total)}</strong>}
    </div>
  );

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
          {family && <span className="row-who">{r.user || NO_USER}</span>}
          {r.family && <span className="badge badge-family">семеен</span>}
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
    <section className={family ? 'page list' : 'page list solo'}>
      <div className="list-head">
        {family ? (
          <div className="dd-row four">
            <Dropdown
              label="Човек"
              value={who}
              defaultValue={user.name}
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
            {kindDropdown}
          </div>
        ) : (
          <>
            <MonthSwitcher month={month} onChange={setMonth} />
            <div className="list-sub">
              {kindDropdown}
              {totalLine}
            </div>
          </>
        )}
        {/* admin/parent: the total only on desktop (on phones the filters take that room) */}
        {family && <div className="desktop-only">{totalLine}</div>}
        <Refreshing show={list.refreshing} />
      </div>

      <StaleNotice show={!!list.error && list.data !== null} onRetry={list.refetch} />
      <Notice text={notice} onDismiss={() => setNotice('')} />

      {/* desktop: column headings for the table-like rows */}
      {days.length > 0 && (
        <div className="rows-head" aria-hidden="true">
          <span>Описание</span>
          <span>Категория</span>
          {family && <span>Човек</span>}
          <span>Тип</span>
          <span>Сума</span>
        </div>
      )}

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
