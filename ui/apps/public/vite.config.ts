import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { bundleBudget } from "../../vite-bundle-budget";

const here = fileURLToPath(new URL(".", import.meta.url));
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

// The public site. Built and served from the site root; the admin app is a
// separate build that lands in dist/admin (see apps/admin/vite.config.ts and
// scripts/build-apps.mjs).
//
// `root` and `envDir` are both explicit because this config is invoked from
// the workspace root (`vite build --config apps/public/vite.config.ts`), so
// neither can be inferred from the working directory. The .env.* files stay
// at the ui root: one set of environment settings for both apps, which is
// also what ui/e2e/config.mjs reads.
export default defineConfig({
  root: here,
  envDir: uiRoot,
  build: {
    outDir: `${uiRoot}dist`,
    // dist/ is outside this app's root, so vite asks to be told explicitly
    // that emptying it is intended. It is: the public build runs FIRST and
    // owns dist/, and the admin build then adds dist/admin/ to it
    // (scripts/build-apps.mjs keeps that order).
    emptyOutDir: true,
  },
  plugins: [
    react(),
    // Ratchet floor for the chunk that decides how much JavaScript a
    // visitor pays for, pinned just above its current minified size
    // (issue #272). Vite's own chunk-size warning fails nothing, which is
    // how the entry chunk grew back past 500 kB after the route splitting
    // of #63. Treat a failure here like a coverage-floor failure: move the
    // weight into a lazily loaded chunk, or raise the number and say why
    // in the PR.
    //
    // "index" is the entry chunk every visitor downloads (currently
    // ~322 kB). The former "admin" budget retired with #591: the admin
    // shell is no longer a chunk of this build at all, it is a separate
    // app, and bundleBudget rejects a budget whose chunk is never emitted.
    //
    // The budget sits roughly 25 kB above today's size. That gap is
    // deliberate: Renovate auto-merges non-major dependency bumps, and a
    // budget pinned to the byte would turn every routine patch release
    // into a red build. 25 kB is small enough that a new dependency or an
    // admin-only import leaking into the entry chunk still trips it, and
    // large enough that ordinary version drift does not.
    // index moved 294 -> 322 kB migrating react-router-dom 6 to
    // react-router 7 (#460). Of that 322 kB, ~56 kB is data-router
    // machinery pulled in by createBrowserRouter, which existed only so
    // the admin unsaved-changes guard could call useBlocker -- a build
    // with <BrowserRouter> measures 265 kB. Now that the admin lives in
    // its own app, this one is free to drop the data router; #533 tracks
    // it.
    bundleBudget({ index: 347 }),
  ],
});
