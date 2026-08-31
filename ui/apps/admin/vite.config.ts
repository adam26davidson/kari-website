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
  build: {
    outDir: `${uiRoot}dist/admin`,
    // Outside this app's root, so vite wants the intent stated explicitly.
    // Only dist/admin is emptied; the public build owns the rest of dist/.
    emptyOutDir: true,
  },
  plugins: [react()],
});
