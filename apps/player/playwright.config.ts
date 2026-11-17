import { defineConfig, devices } from '@playwright/test';

// Browser smoke and Determinism (c) (ADR-0012). The app is built with the test hooks
// (VITE_E2E_HOOKS=1, never in deploy builds) and served by `vite preview`.
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A separate output directory: a build with the hooks never lands in dist/.
    command: `pnpm exec vite build --outDir dist-e2e && pnpm exec vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    env: { VITE_E2E_HOOKS: '1', VITE_BASE: '/' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
