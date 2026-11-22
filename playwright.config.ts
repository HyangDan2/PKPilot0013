import { defineConfig, devices } from '@playwright/test';

// The Pages build lives under a project sub-path, and the preview server has to
// answer on that same path. `PK13_BASE` points the suite at an already-running
// server (used for the live site); `PK13_PORT` moves the local preview when 4173
// is taken by something else on the machine.
const port = Number(process.env.PK13_PORT ?? 4173);
const baseURL = process.env.PK13_BASE ?? `http://127.0.0.1:${port}/PKPilot0013/`;

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
        command: `npm run build && npx vite preview --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
