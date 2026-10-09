import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/payments",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    // Override to run beside another local app (the server's BETTER_AUTH_URL
    // must match, since API calls are origin-checked).
    baseURL: process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
