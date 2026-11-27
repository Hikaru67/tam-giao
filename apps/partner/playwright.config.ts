import { defineConfig, devices } from '@playwright/test';
import { API_BASE_URL, BROWSER_PROJECTS, PARTNER_WEB_PORT } from '../admin/e2e/support/env';

const BASE_URL = `http://localhost:${PARTNER_WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  outputDir: './e2e/.run/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: './e2e/.run/report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    {
      name: BROWSER_PROJECTS[0],
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } },
    },
    {
      name: BROWSER_PROJECTS[1],
      use: { ...devices['Desktop Safari'], viewport: { width: 414, height: 896 } },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PARTNER_WEB_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_URL: API_BASE_URL },
  },
});
