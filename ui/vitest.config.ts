import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

// Vitest configuration for unit/component tests. Kept separate from
// vite.config.ts so the build config stays focused on bundling.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Playwright specs live in e2e/ and must not be run by Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Components import their own .css files; we don't need to process them
    // for logic/render tests.
    css: false,
    // Default values for the Vite env vars the app reads at import time.
    // Individual tests can override with vi.stubEnv().
    env: {
      VITE_API_URL: "https://api.test.local",
      VITE_S3_URL: "https://s3.test.local",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage is opt-in via `npm run test:coverage`; start with the pure
      // logic modules that are worth tracking and expand over time.
      include: ["src/utils/**", "src/services/**"],
    },
  },
});
