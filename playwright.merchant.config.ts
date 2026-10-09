import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/merchant-browser",
  workers: 1,
  timeout: 120000,
  use: {
    // Override to run beside another local app (the server's BETTER_AUTH_URL
    // must match, since API calls are origin-checked).
    baseURL: process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
