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

// Text color for a #rrggbb chip background, always at least WCAG AA (4.5:1): the soft near-black
// when it is readable, else white, else pure black. (The better of pure black and white is never
// below 4.58:1, so one of the three always passes.)
export function textColorFor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#1b1b1b';
  const channel = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const SOFT_DARK_LUM = 0.011; // #1b1b1b
  const contrastDark = (lum + 0.05) / (SOFT_DARK_LUM + 0.05);
  const contrastWhite = 1.05 / (lum + 0.05);
  if (contrastDark >= 4.5) return '#1b1b1b';
  if (contrastWhite >= 4.5) return '#ffffff';
  return '#000000';
}

// Same rules as the server: > 0, < 100000, at most 2 decimals. Accepts comma or dot.
export function parsePrice(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 100000 ? n : null;
}

// Price as shown in an input field: bg decimal comma, always 2 decimals ("17,30").
export function priceToInput(price: number): string {
  return price.toFixed(2).replace('.', ',');
}

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const MONTHS_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const WEEKDAYS_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function currentMonth(): string {
  return todayLocal().slice(0, 7);
}

// month is YYYY-MM.
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// "ср, 1 окт" (year added when it is not the current one).
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS_SHORT[new Date(y, m - 1, d).getDay()];
  const year = y === new Date().getFullYear() ? '' : ` ${y}`;
  return `${weekday}, ${d} ${MONTHS_SHORT[m - 1]}${year}`;
}

const percent = new Intl.NumberFormat('bg-BG', { style: 'percent', maximumFractionDigits: 0 });

export function formatPercent(part: number, whole: number): string {
  return whole > 0 ? percent.format(part / whole) : percent.format(0);
}

// Sums prices in cents to avoid float drift.
export function sumPrices(prices: number[]): number {
  return prices.reduce((cents, p) => cents + Math.round(p * 100), 0) / 100;
}

// Chip color for categories that are inactive or unknown.
export const NEUTRAL_COLOR = '#cfcfca';
