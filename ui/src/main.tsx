import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import { createBrowserRouter } from "react-router";
// RouterProvider comes from the DOM entry point: it is the one export that
// depends on react-dom (it uses flushSync for transition-aware updates).
import { RouterProvider } from "react-router/dom";
import "./index.css";

// A data router (not <BrowserRouter>) so useBlocker can hold navigations
// while an admin editor has unsaved changes. App keeps owning the route
// tree via descendant <Routes>.
// The six v7_* future flags this file carried on v6 are all default
// behaviour in v7, so the options object goes away with them.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

// No Auth0Provider here: App mounts one from a lazy chunk while an /admin
// route is active (auth/admin-auth.tsx), so the SDK stays out of the entry
// bundle that every visitor downloads. Issue #272.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
