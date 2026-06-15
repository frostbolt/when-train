/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_BUSES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by Vite `define` — the build version (git short hash, or "dev").
declare const __APP_VERSION__: string;
