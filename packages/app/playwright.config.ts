import { defineConfig, devices } from "@playwright/test";

// Browser tests run on a phone-sized viewport, against the production build (vite preview) by default.
// With LIVE_URL set (CI's post-deploy job), the same tests run against the deployed staging link instead.
const liveUrl = process.env["LIVE_URL"];
const baseURL = liveUrl ? (liveUrl.endsWith("/") ? liveUrl : `${liveUrl}/`) : "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "on",
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  ...(liveUrl
    ? {}
    : {
        webServer: {
          command: "pnpm preview",
          url: "http://localhost:4173",
          reuseExistingServer: !process.env["CI"],
          timeout: 60_000,
        },
      }),
});
