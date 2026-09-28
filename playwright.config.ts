import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
export default defineConfig({
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  testDir: "./tests", timeout: 120000, expect: { timeout: 30000 }, workers: 1,
  use: { baseURL, trace: process.env.CI ? "off" : "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "android-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "ios-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: process.env.CI_ISOLATED_BACKEND === "1"
    ? { command: "npm run start -- --port 3101", url: baseURL, reuseExistingServer: false, timeout: 60000 }
    : process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120000 },
});
