/// <reference types="vite/client" />

// Build-time variables set by the deploy workflows. All are optional for local builds.
interface ImportMetaEnv {
  readonly VITE_PR_NUMBER?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
  /** "1" exposes `window.__engine` in a production build, for the e2e tests only. */
  readonly VITE_E2E_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
