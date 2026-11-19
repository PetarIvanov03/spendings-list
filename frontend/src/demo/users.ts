import type { Role } from '../auth';

// The made-up demo people (never real names: the repo is public). No side effects, so the
// real build can import it (Login) and drop it, unlike demo/backend.ts.
export const DEMO_USERS: { name: string; role: Role; label: string }[] = [
  { name: 'maria', role: 'admin', label: 'админ' },
  { name: 'georgi', role: 'parent', label: 'родител' },
  { name: 'elena', role: 'parent', label: 'родител' },
  { name: 'niki', role: 'member', label: 'член' },
];
