import { defineConfig } from '@playwright/test';
import { urls } from './harness/ports';

const ci = !!process.env.CI;

// Headless Chromium. Locally the system Chrome (no browser download); CI installs the bundled chromium.
// One worker: all suites share one server + database. Output (traces, screenshots, results) under e2e/.out/.
export default defineConfig({
  testDir: '.',
  testMatch: /w\d\d\.spec\.ts$|harness\/smoke\.spec\.ts$/,
  outputDir: './.out/results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './.out/report', open: 'never' }]],
  globalSetup: './harness/global-setup.ts',
  use: {
    ...(ci ? {} : { channel: 'chrome' }),
    headless: true,
    baseURL: urls().client,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // software GL so WebGL works headless on any machine
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
});
