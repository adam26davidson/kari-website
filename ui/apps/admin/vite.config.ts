import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
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
// - "index" is the chunk loaded on every admin page (734.0 kB). It was
//   649 kB after the split, down from 1,095 kB. Two things then grew it:
//   Font Awesome 7's rewritten React renderer (#793) took it to
//   680.5 kB — the admin used icons throughout, so that cost belonged here
//   rather than being pushed into the public app — and #592 added ~113 kB
//   of shadcn/ui stack on top: Radix's AlertDialog and its
//   dismissable-layer/focus-scope machinery, sonner, the dozen-odd lucide
//   icons the shell's nav names, and cva/clsx/tailwind-merge. That weight
//   is a maintainer's, downloaded once behind a login, and it replaces
//   hand-written overlays that had no focus management at all. Tailwind's
//   own output is CSS and does not count here. #214's helper panel then
//   took it to 808.8 kB: the widget, its session hook and one more lucide
//   glyph. It is deliberately NOT lazy — it is a button in the corner of
//   every admin screen, so a separate chunk would be fetched on every page
//   anyway, for a round trip and no saving. #816 took it to 835.3 kB:
//   Radix's Slider, vendored for the Appearance page's see-through
//   control, is 18.3 kB of that (the primitive plus the collection,
//   direction, use-size and use-previous helpers the rest of the Radix
//   already here does not pull in). Same bargain as #592's: a maintainer's
//   bytes, fetched once behind a login, for a control that is a real
//   slider — role, value, arrow keys, Home/End — rather than a native
//   range input re-skinned per browser engine.
//
//   #856 then took it the other way, from 835.3 kB to 734.0 kB: the admin
//   converged on ONE icon vocabulary, so Font Awesome's renderer and its
//   solid icon set left the bundle entirely and lucide — already here for
//   the shell — draws every glyph. Both budgets below come down with it,
//   because a budget pinned above a weight that has since halved stops
//   guarding anything.
//
//   React 19.3 then took it to 763.6 kB: react-dom's own runtime grew by
//   ~29 kB (the public app's entry grew by the same amount), and the
//   framework every page renders with cannot move into a lazy chunk. The
//   budget moved to 790 kB ahead of that bump, keeping the usual headroom.
// - "blog-post-editor" is the lazy chunk holding the editor, tiptap,
//   prosemirror and their CSS (468.3 kB), fetched only when a post is
//   opened. It was 445 kB until #427 added the link bubble menu, which
//   pulls in @tiptap/react/menus, the bubble/floating menu extensions and
//   floating-ui — 54 kB, and all of it in this chunk rather than "index",
//   which is what the split was for; #856 took the editor toolbar's dozen
//   Font Awesome glyphs out of it again.
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
  //
  // The proxy makes this origin single-origin in dev, the way the built dist
  // and the deployed vhost already are (serve.mjs / nginx: /admin* -> the
  // admin app, everything else -> the public app). Without it the in-editor
  // site preview (#239) has nothing to frame locally: the pane loads `/`,
  // which on 5174 is the ADMIN index, so dev.sh would show an admin app
  // inside the admin app while the deployed site showed the real preview.
  // Everything the admin app itself serves lives under /admin/ because of
  // `base` above — its index, its assets, its HMR client — so handing the
  // rest of the path space to the public dev server takes nothing away.
  // `ws: true` keeps the public app's own HMR socket working inside the
  // frame. 5173 is hardcoded because vite offers no way to ask the sibling
  // server; a parallel stack whose public vite got bumped to 5175 will
  // frame the FIRST stack's site, which affects only the dev pane.
  server: {
    port: 5174,
    proxy: {
      "^/(?!admin($|/))": {
        target: "http://localhost:5173",
        ws: true,
      },
    },
  },
  build: {
    outDir: `${uiRoot}dist/admin`,
    // Outside this app's root, so vite wants the intent stated explicitly.
    // Only dist/admin is emptied; the public build owns the rest of dist/.
    emptyOutDir: true,
  },
  // tailwindcss() is the CSS-first v4 plugin: it compiles
  // src/styles/theme.css, which is the app's only Tailwind entry point.
  plugins: [
    react(),
    tailwindcss(),
    bundleBudget({ index: 790, "blog-post-editor": 495 }),
  ],
});
