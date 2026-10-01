import { useEffect, useRef, type ReactNode } from 'react';
import { currentMonth, monthLabel, NEUTRAL_COLOR, shiftMonth, textColorFor } from './format';
import type { Category } from './types';

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atCurrent = month >= currentMonth(); // cannot go past the current month
  return (
    <div className="month-switcher">
      <button className="icon-btn" aria-label="Предишен месец" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <span className="month-label" aria-live="polite">{monthLabel(month)}</span>
      <button
        className="icon-btn"
        aria-label="Следващ месец"
        disabled={atCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
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
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Затвори" onClick={onClose}>
            ✕
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
      <p className="error" role="alert">{message}</p>
      <button className="primary" onClick={onRetry}>Опитай пак</button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="state muted">{children}</p>;
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
      <button className="link" onClick={onRetry}>Опитай пак</button>
    </div>
  );
}

export function Loading() {
  return <p className="state muted">Зареждане…</p>;
}

// Dismissible status line, e.g. "not sure whether it was saved".
export function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  if (!text) return null;
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button className="icon-btn" aria-label="Скрий съобщението" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

// Row of selectable chips (user filters, scope switchers).
export function ChipRow({ items, value, onChange, label }: {
  items: { value: string | null; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
}) {
  return (
    <div className="filter-row" role="radiogroup" aria-label={label}>
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
export function CategoryChips({ categories, selected, onSelect, labelledBy }: {
  categories: Category[];
  selected: string | null;
  onSelect: (name: string) => void;
  labelledBy?: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-labelledby={labelledBy}>
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
            {on && '✓ '}
            {c.name}
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

const SWATCHES = ['#d9ead3', '#fce5cd', '#cfe2f3', '#fff2cc', '#ead1dc', '#d9d2e9', '#f4cccc', '#d0e0e3'];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const same = (c: string) => c.toLowerCase() === value.toLowerCase();
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={same(c) ? 'swatch on' : 'swatch'}
          style={{ background: c }}
          aria-label={`Цвят ${c}`}
          aria-pressed={same(c)}
          onClick={() => onChange(c)}
        />
      ))}
      <input
        type="color"
        className="color-input"
        aria-label="Избери друг цвят"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#d9ead3'}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
