// Fill these in. Both are safe to commit: the publishable key only works within what
// Row Level Security allows. NEVER put a secret / service_role key anywhere in this repo.
export const SUPABASE_URL = 'https://nkytrjkdpqwgfpqtukck.supabase.co'; // https://<project_id>.supabase.co (no /rest/v1/)
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_V4hFEJ512LLN8Xul2ucUaQ_ng99mfAS';

// Automatic logout after this long without any activity (checked, not just timed: see idle.ts).
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
