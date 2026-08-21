import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComponentType } from "react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./app";
import { SiteSettingsService } from "./services/site-settings";
import { CHUNK_RELOAD_FLAG } from "./components/error-boundary/lazy-with-retry";

// The Auth0 session boundary is fetched as its own chunk from ABOVE the
// shell (app.tsx wraps the whole shell in it on admin routes), so it is
// the one lazy chunk the shell's RouteErrorBoundary sits *below* and
// therefore cannot catch. Uncaught, its failure escapes App and reaches
// the data router in main.tsx, which declares no errorElement -- so a
// maintainer whose tab outlived a redeploy would get React Router's
// "Unexpected Application Error!" instead of the chunk-load prompt
// written for exactly this case in #107.
//
// Its own file because the failure has to be baked in at module scope:
// vitest caches a mock factory per file, so a chunk that fails cannot
// coexist with app.test.tsx's chunk that loads.
vi.mock("./auth/lazy-admin-auth", async () => {
  // The real lazyWithRetry, wrapped around a fetch that always fails --
  // so the retry, the reload gate and the rethrow all behave as they do
  // in the browser. Only the network call is faked.
  const { lazyWithRetry } = await vi.importActual<
    typeof import("./components/error-boundary/lazy-with-retry")
  >("./components/error-boundary/lazy-with-retry");
  const failedFetch = (): Promise<{ default: ComponentType }> =>
    // What Chrome throws when a redeploy removed the hashed chunk file
    // this tab's HTML still points at.
    Promise.reject(
      new TypeError(
        "Failed to fetch dynamically imported module: " +
          "https://example.test/assets/admin-auth-a1b2c3.js",
      ),
    );
  return {
    AdminAuthProvider: lazyWithRetry(failedFetch),
    HeaderUserSection: lazyWithRetry(failedFetch),
  };
});

// App calls useSiteBackground, which otherwise reaches for a hostname
// that does not resolve. Covered in use-site-background.test.tsx.
vi.mock("./services/site-settings", () => ({
  SiteSettingsService: { getFromS3: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
    backgroundPhoto: "",
  });
  // React and the boundary both log the caught error; keep output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // lazyWithRetry auto-reloads once before giving up. The flag is the
  // state a tab comes back in after that reload already happened, which
  // is what makes a persistent failure surface as an error at all
  // (see lazy-with-retry.ts).
  window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
});

afterEach(() => {
  window.sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
});

describe("App with an unloadable admin-auth chunk", () => {
  it("shows the chunk-load prompt instead of letting the error escape", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/haiku"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "A new version of the site may have been deployed — " +
          "reload to get the latest.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
