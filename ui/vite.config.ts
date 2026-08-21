import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { bundleBudget } from "./vite-bundle-budget";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Ratchet floors for the two chunks that decide how much JavaScript a
    // visitor pays for, pinned just above their current minified size
    // (issue #272). Vite's own chunk-size warning fails nothing, which is
    // how the entry chunk grew back past 500 kB after the route splitting
    // of #63. Treat a failure here like a coverage-floor failure: move the
    // weight into a lazily loaded chunk, or raise the number and say why
    // in the PR.
    //
    // - "index" is the entry chunk every visitor downloads, public pages
    //   included (currently ~296 kB). Keep admin-only dependencies out of
    //   it.
    // - "admin" is the admin shell and its tiptap editor stack (~363 kB),
    //   fetched only once a maintainer opens /admin.
    //
    // Each budget sits roughly 25 kB above today's size. That gap is
    // deliberate: Renovate auto-merges non-major dependency bumps, and a
    // budget pinned to the byte would turn every routine patch release
    // into a red build. 25 kB is small enough that a new dependency or an
    // admin-only import leaking into the entry chunk still trips it, and
    // large enough that ordinary version drift does not.
    bundleBudget({ index: 320, admin: 385 }),
  ],
});
