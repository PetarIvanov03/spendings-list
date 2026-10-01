import { useMemo, useState } from 'react';
import { call } from './api';
import type { Session } from './auth';
import { useCategories } from './categories';
import { ChipRow, Empty, ErrorBox, Loading, MonthSwitcher, Refreshing, StaleNotice } from './components';
import { currentMonth, formatEur, formatPercent, NEUTRAL_COLOR } from './format';
import type { AdminUser, SummaryData } from './types';
import { useFetch } from './useFetch';

// One horizontal bar per row, width relative to the largest row.
function Bars({ rows, total, colorOf }: {
  rows: { key: string; label: string; amount: number }[];
  total: number;
  colorOf: (key: string) => string;
}) {
  const max = Math.max(...rows.map((r) => r.amount), 0);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="bar-line">
            <span className="bar-name">{r.label}</span>
            <span className="bar-amount">
              {formatEur(r.amount)} <span className="muted">· {formatPercent(r.amount, total)}</span>
            </span>
          </div>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${max > 0 ? (r.amount / max) * 100 : 0}%`, background: colorOf(r.key) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SummaryScreen({ user }: { user: Session['user'] }) {
  const isAdmin = user.role === 'admin'; // cosmetic: the server decides what each role may read
  const [month, setMonth] = useState(currentMonth);
  const [who, setWho] = useState<string | null>(null); // admin: null = whole family

  const summary = useFetch(
    () =>
      isAdmin
        ? call<SummaryData>('adminSummary', { month, ...(who ? { user: who } : {}) })
        : call<SummaryData>('summary', { month }),
    [month, who, isAdmin],
    { name: 'summary', match: `${month}|${who ?? ''}` },
  );
  const categories = useCategories();
  const users = useFetch(
    () => (isAdmin ? call<AdminUser[]>('adminUsers') : Promise.resolve([])),
    [isAdmin],
    { name: 'adminUsers', match: '' },
  );

  // Only active categories have a color; inactive or removed ones stay neutral.
  const colors = useMemo(() => new Map((categories ?? []).map((c) => [c.name, c.color])), [categories]);
  const data = summary.data;

  return (
    <section className="page">
      <MonthSwitcher month={month} onChange={setMonth} />
      {isAdmin && (
        <ChipRow
          label="Обхват на справката"
          value={who}
          onChange={setWho}
          items={[{ value: null, label: 'Семейство' }, ...(users.data ?? []).map((u) => ({ value: u.name, label: u.name }))]}
        />
      )}

      <Refreshing show={summary.refreshing} />
      <StaleNotice show={!!summary.error && data !== null} onRetry={summary.refetch} />

      {summary.error && data === null ? (
        <ErrorBox message={summary.error} onRetry={summary.refetch} />
      ) : data === null ? (
        <Loading />
      ) : data.byCategory.length === 0 ? (
        <Empty>Няма разходи през този месец.</Empty>
      ) : (
        <>
          <div className="big-total">
            <span className="muted">Общо</span>
            <strong>{formatEur(data.total)}</strong>
          </div>

          <h3 className="section-title">По категории</h3>
          <Bars
            total={data.total}
            rows={data.byCategory.map((c) => ({ key: c.category, label: c.category, amount: c.total }))}
            colorOf={(name) => colors.get(name) ?? NEUTRAL_COLOR}
          />

          {isAdmin && !who && data.byUser && (
            <>
              <h3 className="section-title">По хора</h3>
              <Bars
                total={data.total}
                rows={data.byUser.map((u) => ({
                  key: u.user,
                  label: u.user === '(unassigned)' ? 'Без потребител' : u.user,
                  amount: u.total,
                }))}
                colorOf={() => 'var(--accent)'}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
