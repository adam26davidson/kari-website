import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "./app";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { SiteSettingsService } from "@kari/shared/services/site-settings";

// App is a shell: the admin bar, the site background, and the admin section
// inside it. The section has its own tests (admin.test.tsx); stub it so this
// file exercises only the shell.
vi.mock("./admin", () => ({
  Admin: () => <div>Admin section stub</div>,
}));

vi.mock("@kari/shared/hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
}));

// The header's user section is the shell's only Auth0 consumer, and these
// tests mount no provider.
vi.mock("./auth/admin-auth", () => ({
  AdminAuthProvider: () => null,
  HeaderUserSection: () => <div className="header-user-section">User stub</div>,
}));

// App calls useSiteBackground, which reads site-settings.json straight from
// S3; unstubbed it reaches for a hostname that does not resolve. The hook's
// own behaviour is covered in the shared package.
vi.mock("@kari/shared/services/site-settings", () => ({
  SiteSettingsService: { getFromS3: vi.fn() },
}));

function renderApp() {
  return render(
    <MemoryRouter basename="/admin" initialEntries={["/admin/home"]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
  // Re-stubbed per test: setup.ts's vi.restoreAllMocks() drops any
  // implementation set at mock-declaration time.
  vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
    backgroundPhoto: "",
  });
});

describe("the admin shell", () => {
  it("renders the admin bar and the section inside it", () => {
    const { container } = renderApp();
    expect(screen.getByText("Kari Davidson - Admin")).toBeInTheDocument();
    expect(screen.getByText("Admin section stub")).toBeInTheDocument();
    expect(container.querySelector(".admin-header")).not.toBeNull();
  });

  // The same frame the public site uses, from the shared stylesheet: the
  // fixed-height page with one inner scroller. e2e/screenshots.mjs grows the
  // viewport by looking for exactly these, so an admin page whose shell lost
  // them would be captured at one viewport-height and reviewed half-blind.
  it("uses the shared page frame", () => {
    const { container } = renderApp();
    expect(container.querySelector(".whole-page > .content")).not.toBeNull();
  });

  it("shows the signed-in user in the bar", () => {
    renderApp();
    expect(screen.getByText("User stub")).toBeInTheDocument();
  });

  it("shows the phone menu instead of the section when opened", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderApp();
    expect(screen.getByText("Admin section stub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.queryByText("Admin section stub")).toBeNull();
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveAttribute(
      "href",
      "/haiku",
    );
  });
});
