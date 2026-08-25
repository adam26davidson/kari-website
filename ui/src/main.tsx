import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

// A data router (not <BrowserRouter>) so useBlocker can hold navigations
// while an admin editor has unsaved changes. App keeps owning the route
// tree via descendant <Routes>.
const router = createBrowserRouter([{ path: "*", element: <App /> }], {
  future: {
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_relativeSplatPath: true,
    v7_skipActionErrorRevalidation: true,
  },
});

// No Auth0Provider here: App mounts one from a lazy chunk while an /admin
// route is active (auth/admin-auth.tsx), so the SDK stays out of the entry
// bundle that every visitor downloads. Issue #272.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
);
