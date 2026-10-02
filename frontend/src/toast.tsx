import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// How long the leaving animation lasts: --dur-base from the stylesheet (one place to tune).
const exitMs = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-base')) || 220;

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [leaving, setLeaving] = useState(false); // plays the leaving animation before the toast is removed
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    setLeaving(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLeaving(true);
      timer.current = window.setTimeout(() => setMessage(''), exitMs());
    }, 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" role="status">
        {message && <div className={leaving ? 'toast leaving' : 'toast'}>{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
