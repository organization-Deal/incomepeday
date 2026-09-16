import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.js', workers: 1,
  use: { browserName: 'chromium', headless: true },
});
