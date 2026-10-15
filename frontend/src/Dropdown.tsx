import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown } from './icons';

// Compact dropdowns for the filter rows. The panel is portaled to <body> and positioned with
// fixed coordinates from the trigger, so it is never clipped by a scroller and is kept inside
// the screen (shifted left, flipped above the trigger when there is no room below).
export interface Option<T> {
  value: T;
  label: string;
}

const MARGIN = 8;
const PANEL_MIN_WIDTH = 220;

interface ShellProps {
  label: string; // what this dropdown filters, for screen readers
  text: string; // closed label
  active: boolean; // a non-default choice: the trigger is tinted
  multi?: boolean;
  children: (close: () => void) => ReactNode;
}

function DropdownShell({ label, text, active, multi = false, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const width = Math.min(Math.max(r.width, PANEL_MIN_WIDTH), vw - 2 * MARGIN);
    const left = Math.min(Math.max(r.left, MARGIN), vw - width - MARGIN);
    const below = vh - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const up = below < 200 && above > below;
    setStyle({
      left,
      width,
      maxHeight: Math.min(360, up ? above : below),
      ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', outside, true); // any scroller except the panel itself
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={active ? 'dd-trigger active' : 'dd-trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dd-text">{text}</span>
        <IconChevronDown size={16} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="dd-panel" role="listbox" aria-label={label} aria-multiselectable={multi || undefined} style={style}>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

function OptionRow({ label, selected, box = false, onClick }: { label: string; selected: boolean; box?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className="dd-option" onClick={onClick}>
      <span className={box ? 'dd-mark box' : 'dd-mark'}>{selected && <IconCheck size={14} />}</span>
      <span className="dd-label">{label}</span>
    </button>
  );
}

// Pick one value. `text` overrides the closed label (e.g. a shorter month name).
export function Dropdown<T extends string | null>({ label, value, options, onChange, text, defaultValue }: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  text?: string;
  defaultValue?: T; // the "no filter" choice: any other value tints the trigger
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownShell
      label={label}
      text={text ?? current?.label ?? ''}
      active={defaultValue !== undefined && value !== defaultValue}
    >
      {(close) =>
        options.map((o) => (
          <OptionRow
            key={o.value ?? '__none'}
            label={o.label}
            selected={o.value === value}
            onClick={() => {
              onChange(o.value);
              close();
            }}
          />
        ))
      }
    </DropdownShell>
  );
}

// Pick any number of values; an empty selection means "all" (shown as "Всички").
export function MultiDropdown({ label, options, selected, onChange, noun }: {
  label: string;
  options: Option<string>[];
  selected: string[];
  onChange: (v: string[]) => void;
  noun: string; // plural, for "N <noun>"
}) {
  const text = selected.length === 0 ? 'Всички' : selected.length === 1 ? selected[0] : `${selected.length} ${noun}`;
  function toggle(v: string) {
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    onChange(next.length === options.length ? [] : next); // everything picked = no filter
  }
  return (
    <DropdownShell label={label} text={text} active={selected.length > 0} multi>
      {() => (
        <>
          <OptionRow label="Всички" selected={selected.length === 0} box onClick={() => onChange([])} />
          {options.map((o) => (
            <OptionRow key={o.value} label={o.label} selected={selected.includes(o.value)} box onClick={() => toggle(o.value)} />
          ))}
        </>
      )}
    </DropdownShell>
  );
}
