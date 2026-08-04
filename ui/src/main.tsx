import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { Auth0Provider } from "@auth0/auth0-react";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Auth0Provider
      domain="dev-ivkddn8ec0pdwd5a.us.auth0.com"
      clientId="gEuLXgSWSpVoqjJSv5gs5qb2a83Tz0JM"
      authorizationParams={{
        redirect_uri: window.location.origin + "/admin",
        audience: "https://api.karidavidson.com/",
      }}
      // Test builds persist tokens to localStorage so Playwright can capture
      // an authenticated storageState once and reuse it across e2e tests.
      // Production keeps the default in-memory cache.
      cacheLocation={
        import.meta.env.MODE === "test" ? "localstorage" : undefined
      }
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Auth0Provider>
  </React.StrictMode>,
);
