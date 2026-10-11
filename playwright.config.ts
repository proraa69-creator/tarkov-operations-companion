import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  // tests/ holds the older specs; new ones live next to their feature as *.e2e.ts, because the VPS publisher refuses any
  // changed file under tests/ (docs/coordination/ops-reference/release-policy.mjs deployPath).
  testMatch: ['tests/**/*.spec.ts', 'src/**/*.e2e.ts'],
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
