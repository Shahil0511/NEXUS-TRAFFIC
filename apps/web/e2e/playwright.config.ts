/**
 * Playwright SMOKE of the running Docker stack through the local gateway copy (`edge`).
 *
 * WHY: unit + component tests prove the pieces; this proves the built images, the nginx routing
 * (/traffic → web, /traffic/api → api, /traffic/socket.io websocket) and the SSO cookie together.
 * NOT part of `npm test` — it needs the stack:
 *
 *   docker compose --profile localdb --profile local up -d --build
 *   npx playwright install chromium        # once per machine
 *   npm run test:smoke                     # repo root
 *
 * SMOKE_BASE_URL overrides the target (default http://localhost:8080/traffic). The admin cookie is
 * minted from the repo-root .env (LIBAS_JWT_SECRET, first DASHBOARD_ADMIN_EMAILS) — local only.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  outputDir: '../test-results/smoke',
});
