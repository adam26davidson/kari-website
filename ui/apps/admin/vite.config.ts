import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { bundleBudget } from "../../vite-bundle-budget";

const here = fileURLToPath(new URL(".", import.meta.url));
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

// The admin app. It is served under /admin, so `base` prefixes every asset
// URL the built index.html references and the router is mounted with a
// matching basename (see src/main.tsx).
//
// This app had no bundle budget for a while after #591: its weight is not
// something a visitor pays for, so the public app kept the only ratchet.
// The admin then grew to a 1,095 kB entry chunk, half of it the tiptap /
// prosemirror editor stack that every admin page loaded whether or not it
// ever showed an editor. #419 moved that stack behind a lazy import in
// admin-other-works-page.tsx; these two budgets keep it there.
//
// - "index" is the chunk loaded on every admin page (649 kB after the
//   split, down from 1,095 kB).
// - "blog-post-editor" is the lazy chunk holding the editor, tiptap,
//   prosemirror and their CSS (445 kB), fetched only when a post is
//   opened.
//
// Budgeting the lazy chunk is the real regression guard, and it guards in
// both directions: bundleBudget also fails when a budgeted chunk is never
// emitted, so re-introducing a static import of the editor — which would
// dissolve this chunk back into "index" — fails the build by name instead
// of quietly doubling what the admin downloads.
//
// Both sit roughly 25 kB above today's size, the same headroom and for the
// same reason as the public app's budget: Renovate auto-merges non-major
// bumps, and a budget pinned to the byte turns every routine patch release
// red. Treat a failure like a coverage-floor failure — move the weight
// into a lazily loaded chunk, or raise the number and say why in the PR.
export default defineConfig({
  root: here,
  base: "/admin/",
  envDir: uiRoot,
  // A port of its own, because scripts/dev.sh now starts both dev servers at
  // once (#593) and vite's default is 5173 for each of them: without this,
  // which app answers on which port is a startup race. It matters more here
  // than for the public app because Auth0 allowlists callback URLs per
  // origin, so a shifting port means a login that cannot come back.
  // Deliberately no `strictPort`: parallel worktree stacks still need vite's
  // "5174 is taken, using 5175" behaviour, and a second stack's admin login
  // is a rarer need than a second stack starting at all.
  server: { port: 5174 },
  build: {
    outDir: `${uiRoot}dist/admin`,
    // Outside this app's root, so vite wants the intent stated explicitly.
    // Only dist/admin is emptied; the public build owns the rest of dist/.
    emptyOutDir: true,
  },
  plugins: [react(), bundleBudget({ index: 675, "blog-post-editor": 470 })],
});
