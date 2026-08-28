/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Demo credentials pre-filled into the login form. Set ONLY on the public
   * demo instance (whose data is entirely invented) — a real deployment builds
   * without them, so the fields come up empty. See screens/Login.tsx.
   */
  readonly VITE_DEMO_USERNAME?: string;
  readonly VITE_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
