/// <reference types="vite/client" />

// Build-time variables set by the deploy workflows. All are optional for local builds.
interface ImportMetaEnv {
  readonly VITE_PR_NUMBER?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
