import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the production build (vite preview), on a phone-sized viewport.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    video: "on",
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
