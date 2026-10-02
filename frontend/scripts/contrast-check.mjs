// WCAG AA contrast check of the design tokens (light and dark) and of the text color the app
// picks on every category chip color. No dependencies: `npm run contrast`. Exits 1 on a failure.
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

const parseTokens = (block) => {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
};
const light = parseTokens(css.match(/:root \{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...parseTokens(css.match(/prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/)[1]) };

const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function luminance(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground token, background token, minimum ratio, what it is]
const PAIRS = [
  ['text', 'surface-0', 4.5, 'body text on page'],
  ['text', 'surface-1', 4.5, 'body text on cards and sheets'],
  ['text', 'surface-2', 4.5, 'text on tracks / skeleton'],
  ['text', 'segment-on', 4.5, 'selected segment'],
  ['text-2', 'surface-2', 4.5, 'unselected segment on the track'],
  ['text-2', 'surface-0', 4.5, 'secondary text on page'],
  ['text-2', 'surface-1', 4.5, 'secondary text on cards'],
  ['text-2', 'surface-2', 4.5, 'secondary text on inset (badge, segmented)'],
  ['text-3', 'surface-0', 4.5, 'hints on page'],
  ['text-3', 'surface-1', 4.5, 'hints on cards (tab labels, meta)'],
  ['text-3', 'surface-2', 4.5, 'hints on inset (inactive badge)'],
  ['accent', 'surface-0', 4.5, 'links on page'],
  ['accent', 'surface-1', 4.5, 'active tab, ghost buttons on cards'],
  ['accent', 'accent-soft', 4.5, 'admin badge, ghost hover'],
  ['on-accent', 'accent', 4.5, 'primary button text'],
  ['on-accent', 'accent-hover', 4.5, 'primary button hover text'],
  ['success', 'surface-1', 4.5, 'success text on cards'],
  ['success', 'success-soft', 4.5, 'success badge / notice'],
  ['warning', 'warning-soft', 4.5, 'offline banner'],
  ['danger', 'surface-0', 4.5, 'error text on page'],
  ['danger', 'surface-1', 4.5, 'error text on cards / sheets'],
  ['danger', 'danger-soft', 4.5, 'danger outline hover'],
  ['on-danger', 'danger-solid', 4.5, 'danger button text'],
  ['surface-0', 'text', 4.5, 'toast / retry pill (inverted)'],
  ['accent', 'surface-1', 3, 'focus ring and icons (non-text)'],
  ['line-strong', 'surface-1', 3, 'input borders (non-text)'],
];

let failures = 0;
const row = (theme, a, b, min, what, got) => {
  const ok = got >= min;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${(a + ' on ' + b).padEnd(34)} ${got.toFixed(2).padStart(5)} (min ${min})  ${what}`);
};
for (const [name, tokens] of [['light', light], ['dark', dark]]) {
  for (const [a, b, min, what] of PAIRS) row(name, a, b, min, what, ratio(tokens[a], tokens[b]));
}

// Category chips: the app picks the text color per chip color (format.ts textColorFor; keep in sync).
const chipText = (hex) => {
  const lum = luminance(hex);
  if ((lum + 0.05) / (luminance('#1b1b1b') + 0.05) >= 4.5) return '#1b1b1b';
  if (1.05 / (lum + 0.05) >= 4.5) return '#ffffff';
  return '#000000';
};
const colors = new Set([
  ...(read('../src/supabase.ts').match(/PALETTE = \[([^\]]+)\]/)[1].match(/#[0-9a-fA-F]{6}/g) ?? []), // category colors
  ...(read('../src/format.ts').match(/NEUTRAL_COLOR = '(#[0-9a-fA-F]{6})'/) ?? []).slice(1),
  '#000000', '#ffffff', '#777777', '#767676', '#808080', '#0000ff', '#ff0000', '#00aa00', '#ff8800', // worst cases
]);
let worst = { r: 99, c: '' };
for (const c of colors) {
  const r = ratio(chipText(c), c);
  if (r < worst.r) worst = { r, c };
  if (r < 4.5) { failures++; console.log(`FAIL  chip ${c}: ${r.toFixed(2)}`); }
}
console.log(`${worst.r >= 4.5 ? 'PASS' : 'FAIL'}  ${colors.size} chip colors checked, lowest text contrast ${worst.r.toFixed(2)} (${worst.c}), min 4.5`);

console.log(failures === 0 ? '\nALL CONTRAST CHECKS PASSED' : `\n${failures} CONTRAST CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
