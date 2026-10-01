/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MOCK?: string; // '1' = in-memory mock backend, dev server only
}

declare const __BUILD_ID__: string;
