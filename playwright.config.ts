import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PK13_BASE ?? 'http://127.0.0.1:4173/PKPilot0013/';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.playwright-artifacts',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PK13_BASE
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
