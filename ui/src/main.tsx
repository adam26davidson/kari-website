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
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Auth0Provider>
  </React.StrictMode>
);
