import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import { BrowserRouter } from "react-router";
import "@kari/shared/styles/index.css";

// The DECLARATIVE router, deliberately -- not createBrowserRouter +
// RouterProvider. A data router drags ~56 kB of extra machinery (loaders,
// fetchers, revalidation, the whole navigation state machine) into the
// entry chunk that every public visitor downloads, and this app uses none
// of it: App owns the route tree via descendant <Routes>, no route has a
// loader or an action, and nothing here calls a data-router-only hook.
//
// The one thing that ever needed a data router was the admin
// unsaved-changes guard's useBlocker. That lives in the admin app now
// (apps/admin/src/main.tsx keeps its data router), so the public app is
// free to drop it -- issue #533, and the `index` budget in vite.config.ts
// came down with it.
//
// No Auth0 anywhere in this app either: the admin section is its own build,
// served under /admin (issue #591). Issue #272 is what put the SDK behind a
// lazy chunk before that; the split makes it structural.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
