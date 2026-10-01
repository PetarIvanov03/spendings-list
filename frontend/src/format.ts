const eur = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });

export function formatEur(amount: number): string {
  return eur.format(amount);
}

// Today as YYYY-MM-DD in the device's local time zone.
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Picks black or white text, whichever has the better contrast on a #rrggbb background.
export function textColorFor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#1b1b1b';
  const channel = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const contrastWithBlack = (lum + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (lum + 0.05);
  return contrastWithBlack >= contrastWithWhite ? '#1b1b1b' : '#ffffff';
}
