/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_DEV_ACCESS_TOKEN?: string;
  readonly VITE_DEVICE_ID?: string;
  readonly VITE_WORKSPACE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
