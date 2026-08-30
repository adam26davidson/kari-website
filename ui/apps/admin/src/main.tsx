import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import { createBrowserRouter } from "react-router";
// RouterProvider comes from the DOM entry point: it is the one export that
// depends on react-dom (it uses flushSync for transition-aware updates).
import { RouterProvider } from "react-router/dom";
import { AdminAuthProvider } from "./auth/admin-auth";
import "@kari/shared/styles/index.css";

// The admin app is served under /admin (vite.config.ts sets the matching
// asset `base`), so the router is mounted with that basename: every route
// and <Link> inside the app is written as if it owned the site root, and
// react-router adds the prefix on the way out and strips it on the way in.
//
// A data router (not <BrowserRouter>) because the unsaved-changes guard
// needs useBlocker. App owns the route tree below this via descendant
// <Routes>.
const router = createBrowserRouter([{ path: "*", element: <App /> }], {
  basename: "/admin",
});

// Auth0 wraps the whole app, statically. Under #272 the SDK was hidden
// behind a lazy chunk so public visitors never downloaded it; with the
// admin split into its own build (#591) that separation is structural, and
// every route here needs a session anyway.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider>
  </React.StrictMode>,
);
