import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const here = fileURLToPath(new URL(".", import.meta.url));
const uiRoot = fileURLToPath(new URL("../..", import.meta.url));

// The admin app. It is served under /admin, so `base` prefixes every asset
// URL the built index.html references and the router is mounted with a
// matching basename (see src/main.tsx).
//
// No bundle budget here: the admin section is maintainer-facing and behind
// a login, and the whole point of splitting it out (#591) is that its weight
// is no longer something a visitor pays for. The public app keeps its
// ratchet.
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
  plugins: [react()],
});
