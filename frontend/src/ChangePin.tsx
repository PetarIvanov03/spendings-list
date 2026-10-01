import { useState } from 'react';
import { call } from './api';
import { pinLength, type Session } from './auth';
import { Sheet } from './components';
import { useOnline } from './online';
import { PinPad } from './PinPad';
import { runWrite } from './write';

type Step = 'old' | 'new' | 'repeat';

const TITLES: Record<Step, string> = {
  old: 'Въведи текущия ПИН',
  new: 'Въведи новия ПИН',
  repeat: 'Повтори новия ПИН',
};

// Own PIN change: current PIN, new PIN, repeat. On success every token is invalidated
// (the server bumps tokenVersion), so the caller sends the user back to the login screen.
export function ChangePinSheet({ user, onClose, onChanged }: {
  user: Session['user'];
  onClose: () => void;
  onChanged: () => void;
}) {
  const length = pinLength(user.role);
  const online = useOnline();
  const [step, setStep] = useState<Step>('old');
  const [pins, setPins] = useState<Record<Step, string>>({ old: '', new: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setPin = (value: string) => setPins((p) => ({ ...p, [step]: value }));
  const restart = (message: string) => {
    setPins({ old: '', new: '', repeat: '' });
    setStep('old');
    setError(message);
  };

  async function submit() {
    setBusy(true);
    const r = await runWrite(() => call('changePin', { oldPin: pins.old, newPin: pins.new }));
    if (r.ok) return onChanged();
    setBusy(false);
    // Wrong current PIN is FORBIDDEN (not UNAUTHORIZED), so we stay logged in.
    if (r.code === 'FORBIDDEN') return restart('Грешен текущ ПИН.');
    if (r.uncertain) {
      return restart('Не съм сигурен дали ПИН-ът е сменен. Ако следващата заявка те изкара навън, влез с новия ПИН.');
    }
    restart(r.message);
  }

  function next() {
    setError('');
    if (step === 'old') setStep('new');
    else if (step === 'new') setStep('repeat');
    else if (pins.repeat !== pins.new) {
      setPins({ old: pins.old, new: '', repeat: '' });
      setStep('new');
      setError('ПИН-овете не съвпадат. Опитай пак.');
    } else void submit();
  }

  return (
    <Sheet title="Смяна на ПИН" onClose={onClose}>
      <p className="muted">
        {TITLES[step]} ({length} цифри)
      </p>
      <PinPad
        pin={pins[step]}
        onChange={setPin}
        maxLength={length}
        dots={length}
        canSubmit={pins[step].length === length && online && !busy}
        busy={busy}
        okLabel={step === 'repeat' ? 'Смени' : 'Напред'}
        onSubmit={next}
      />
      <p className="error" role="alert">{error}</p>
      {!online && <p className="muted">Няма връзка — промените са изключени.</p>}
      {step !== 'old' && !busy && (
        <button className="link" onClick={() => { setStep(step === 'repeat' ? 'new' : 'old'); setError(''); }}>
          ← Назад
        </button>
      )}
    </Sheet>
  );
}
