import { useEffect } from 'react';
import { IconBackspace } from './icons';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

// Numeric PIN pad: dots, big keys, no system keyboard. The PIN lives in the parent;
// submit is always explicit (OK), never automatic.
export function PinPad(props: {
  pin: string;
  onChange: (pin: string) => void;
  onSubmit: () => void;
  maxLength: number;
  dots?: number; // number of dots to draw (default: at least 4)
  canSubmit: boolean;
  busy: boolean;
  okLabel?: string;
}) {
  const { pin, onChange, onSubmit, maxLength, canSubmit, busy } = props;

  const press = (key: string) => {
    if (busy) return;
    if (key === 'back') onChange(pin.slice(0, -1));
    else if (key === 'ok') {
      if (canSubmit) onSubmit();
    } else if (pin.length < maxLength) onChange(pin + key);
  };

  // Physical keyboard on desktop. Typing in a text field (e.g. a name) must not feed the pad.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter' && el.tagName !== 'BUTTON') press('ok'); // a focused button clicks itself
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dots = props.dots ?? Math.max(4, pin.length);
  return (
    <>
      <div className="pin-dots" aria-label={`Въведени цифри: ${pin.length}`}>
        {Array.from({ length: dots }, (_, i) => (
          <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
        ))}
      </div>
      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === 'ok' ? 'key key-ok' : 'key'}
            disabled={k === 'ok' ? !canSubmit || busy : busy}
            aria-label={k === 'back' ? 'Изтрий' : undefined}
            onClick={() => press(k)}
          >
            {k === 'back' ? <IconBackspace size={26} /> : k === 'ok' ? (busy ? '…' : props.okLabel ?? 'OK') : k}
          </button>
        ))}
      </div>
    </>
  );
}
