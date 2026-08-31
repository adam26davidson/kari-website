// Builds both apps of the workspace into ONE dist/ directory:
//
//   dist/          the public site (apps/public)
//   dist/admin/    the admin app   (apps/admin, served under /admin)
//
// One directory because that is what the deploy pipeline ships: deploy.yml
// copies ui/dist into the CodeDeploy bundle and both appspecs drop it at the
// nginx document root. Keeping the merge here means neither file has to know
// the site is built from two vite projects.
//
// Order is load-bearing and therefore sequential: the public build empties
// dist/, so it has to run before the admin build writes dist/admin into it.
//
// Usage: node scripts/build-apps.mjs [vite-mode]
//   e.g. `node scripts/build-apps.mjs test` for the e2e/test-mode bundle.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const mode = process.argv[2];

/** Public first: it owns (and empties) dist/. @type {string[]} */
const configs = ["apps/public/vite.config.ts", "apps/admin/vite.config.ts"];

for (const config of configs) {
  const args = ["build", "--config", config];
  if (mode) args.push("--mode", mode);
  const result = spawnSync("npx", ["vite", ...args], {
    cwd: UI_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
