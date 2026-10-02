import { useEffect, useRef, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconInbox } from './icons';
import { currentMonth, monthLabel, NEUTRAL_COLOR, shiftMonth, textColorFor } from './format';
import type { Category } from './types';

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atCurrent = month >= currentMonth(); // cannot go past the current month
  return (
    <div className="month-switcher">
      <button className="icon-btn" aria-label="Предишен месец" onClick={() => onChange(shiftMonth(month, -1))}>
        <IconChevronLeft />
      </button>
      <span className="month-label" aria-live="polite">{monthLabel(month)}</span>
      <button
        className="icon-btn"
        aria-label="Следващ месец"
        disabled={atCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <IconChevronRight />
      </button>
    </div>
  );
}

// Bottom sheet modal. Escape or a tap on the backdrop closes it.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A confirm dialog on top handles Escape itself.
      if (e.key === 'Escape' && !document.querySelector('.confirm')) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Затвори" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="overlay overlay-top" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        <p>{props.message}</p>
        <div className="confirm-actions">
          <button className="secondary" autoFocus onClick={props.onCancel}>
            Отказ
          </button>
          <button className={props.danger ? 'danger' : 'primary'} disabled={props.busy} onClick={props.onConfirm}>
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state">
      <span className="state-icon bad"><IconAlert size={28} /></span>
      <p className="state-title">Нещо се обърка</p>
      <p className="error" role="alert">{message}</p>
      <button className="primary" onClick={onRetry}>Опитай пак</button>
    </div>
  );
}

export function Empty({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="state">
      <span className="state-icon"><IconInbox size={28} /></span>
      <p className="state-title">{children}</p>
      {hint && <p>{hint}</p>}
    </div>
  );
}

// Skeleton placeholders with the same size as the content they stand for, so nothing shifts
// when the data arrives.
export function Loading({ variant = 'rows' }: { variant?: 'rows' | 'summary' | 'chips' }) {
  if (variant === 'chips') {
    return (
      <div className="chips grid" role="status" aria-label="Зареждане">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 52, borderRadius: 16 }} />
        ))}
      </div>
    );
  }
  if (variant === 'summary') {
    return (
      <div role="status" aria-label="Зареждане">
        <div className="card hero">
          <div className="skeleton" style={{ width: 72, height: 14 }} />
          <div className="skeleton" style={{ width: 200, height: 44, marginTop: 8 }} />
        </div>
        <div className="card bars">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="skeleton" style={{ width: `${60 - i * 12}%`, height: 16, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 10, borderRadius: 999 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="card rows" role="status" aria-label="Зареждане">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-lines">
            <div className="skeleton" style={{ width: `${62 - i * 7}%`, height: 16 }} />
            <div className="skeleton" style={{ width: '32%', height: 12 }} />
          </div>
          <div className="skeleton" style={{ width: 64, height: 18 }} />
        </div>
      ))}
    </div>
  );
}

// "обновявам…" while cached data is shown and a refresh is running. Keeps its height.
export function Refreshing({ show }: { show: boolean }) {
  return <div className="refresh-line" role="status">{show ? 'обновявам…' : ''}</div>;
}

// A refresh failed but the previous data is still shown.
export function StaleNotice({ show, onRetry }: { show: boolean; onRetry: () => void }) {
  if (!show) return null;
  return (
    <div className="notice" role="status">
      <span>Не успях да обновя. Показвам последните данни.</span>
      <button className="ghost" onClick={onRetry}>Опитай пак</button>
    </div>
  );
}

// Dismissible status line, e.g. "not sure whether it was saved".
export function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  if (!text) return null;
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button className="icon-btn" aria-label="Скрий съобщението" onClick={onDismiss}>
        <IconClose size={20} />
      </button>
    </div>
  );
}

// Row of selectable pills (user filters, scope switchers). `segmented`: equal-width control
// for a few fixed options.
export function ChipRow({ items, value, onChange, label, segmented = false }: {
  items: { value: string | null; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  segmented?: boolean;
}) {
  return (
    <div className={segmented ? 'filter-row segmented' : 'filter-row'} role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button
          key={i.value ?? '__all'}
          role="radio"
          aria-checked={i.value === value}
          className={i.value === value ? 'filter-chip on' : 'filter-chip'}
          onClick={() => onChange(i.value)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

// Colored category chips, one tap to select. The categories passed in are the options.
// The selected one has a check mark, a heavier weight and a ring: not color alone.
export function CategoryChips({ categories, selected, onSelect, labelledBy, grid = false }: {
  categories: Category[];
  selected: string | null;
  onSelect: (name: string) => void;
  labelledBy?: string;
  grid?: boolean;
}) {
  return (
    <div className={grid ? 'chips grid' : 'chips'} role="radiogroup" aria-labelledby={labelledBy}>
      {categories.map((c) => {
        const on = c.name === selected;
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'chip selected' : 'chip'}
            style={{ background: c.color, color: textColorFor(c.color) }}
            onClick={() => onSelect(c.name)}
          >
            {on && <IconCheck size={18} />}
            <span>{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// Small colored tag with the category name (neutral when the category is not active).
export function CategoryTag({ name, colors }: { name: string; colors: Map<string, string> }) {
  const bg = colors.get(name) ?? NEUTRAL_COLOR;
  return (
    <span className="tag" style={{ background: bg, color: textColorFor(bg) }}>
      {name}
    </span>
  );
}
