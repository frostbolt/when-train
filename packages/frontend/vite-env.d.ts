/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_BUSES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
