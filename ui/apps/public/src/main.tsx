import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import { createBrowserRouter } from "react-router";
// RouterProvider comes from the DOM entry point: it is the one export that
// depends on react-dom (it uses flushSync for transition-aware updates).
import { RouterProvider } from "react-router/dom";
import "@kari/shared/styles/index.css";

// A data router (not <BrowserRouter>). App keeps owning the route tree via
// descendant <Routes>.
// The reason for the data router was the admin unsaved-changes guard's
// useBlocker, which now lives in the admin app; #533 tracks dropping it
// here and getting ~56 kB of the entry chunk back.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

// No Auth0 anywhere in this app: the admin section is its own build, served
// under /admin (issue #591). Issue #272 is what put the SDK behind a lazy
// chunk before that; the split makes it structural.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
