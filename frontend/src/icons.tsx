import type { ReactNode } from 'react';

// Inline SVG icons (no icon library). All 24x24, drawn with currentColor strokes, so they
// follow the text color of their button and work in both themes and offline.
function Icon({ children, size = 24, filled = false }: { children: ReactNode; size?: number; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const IconPlus = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const IconList = (p: P) => <Icon {...p}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Icon>;
export const IconChart = (p: P) => <Icon {...p}><path d="M5 20V11M12 20V4M19 20v-6" /></Icon>;
export const IconGear = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
export const IconMore = (p: P) => <Icon {...p}><path d="M12 5.5h.01M12 12h.01M12 18.5h.01" strokeWidth="3" /></Icon>;
export const IconClose = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const IconCheck = (p: P) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth="2.6" /></Icon>;
export const IconChevronLeft = (p: P) => <Icon {...p}><path d="M14.5 5.5L8 12l6.5 6.5" /></Icon>;
export const IconChevronRight = (p: P) => <Icon {...p}><path d="M9.5 5.5L16 12l-6.5 6.5" /></Icon>;
export const IconArrowUp = (p: P) => <Icon {...p}><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" /></Icon>;
export const IconArrowDown = (p: P) => <Icon {...p}><path d="M12 5v13M6.5 12.5L12 18l5.5-5.5" /></Icon>;
export const IconEye = (p: P) => (
  <Icon {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const IconEyeOff = (p: P) => (
  <Icon {...p}>
    <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);
export const IconBackspace = (p: P) => <Icon {...p}><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9.5l-5 5M12 9.5l5 5" /></Icon>;
export const IconCalendar = (p: P) => <Icon {...p}><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4M16 3v4" /></Icon>;
export const IconAlert = (p: P) => <Icon {...p}><path d="M12 8v5M12 16.5h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></Icon>;
export const IconWifiOff = (p: P) => <Icon {...p}><path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.3M12 20h.01M19 12.9a10 10 0 0 0-3.7-2.2M2 9a15 15 0 0 1 5-3" /></Icon>;
export const IconInbox = (p: P) => <Icon {...p}><path d="M3 13l2.5-7.2A2 2 0 0 1 7.4 4.5h9.2a2 2 0 0 1 1.9 1.3L21 13M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M3 13h5l1 2.5h6l1-2.5h5" /></Icon>;
export const IconUser = (p: P) => <Icon {...p}><path d="M5 20a7 7 0 0 1 14 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></Icon>;
export const IconLock = (p: P) => <Icon {...p}><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" /></Icon>;
export const IconLogout = (p: P) => <Icon {...p}><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9" /></Icon>;
export const IconEdit = (p: P) => <Icon {...p}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3" /></Icon>;
export const IconKey = (p: P) => <Icon {...p}><path d="M15 3.5a5.5 5.5 0 1 1-1.5 10.8L11 17H8.5v2.5H6V22H3v-3l8.2-8.2A5.5 5.5 0 0 1 15 3.5zM16.5 8h.01" /></Icon>;

// App mark: a euro sign in a rounded square (same drawing as the PWA icon).
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="11" fill="var(--accent)" />
      <path
        d="M31.5 17.2a9.2 9.2 0 1 0 0 13.6M13.5 21.2h14M13.5 26.8h14"
        fill="none"
        stroke="var(--on-accent, #ffffff)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
