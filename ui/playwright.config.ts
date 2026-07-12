import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests. These build the app and serve the production bundle
// with `vite preview`, then drive it in a real browser — the most reliable way
// to catch runtime breakage from a dependency bump that unit tests miss.
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Build then preview so the test runs against the real production output.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Dummy backend URLs so the build embeds resolvable (if unreachable) values.
    // The smoke assertions are network-independent.
    env: {
      VITE_API_URL: process.env.VITE_API_URL ?? "https://api.smoke.local",
      VITE_S3_URL: process.env.VITE_S3_URL ?? "https://s3.smoke.local",
    },
  },
});
