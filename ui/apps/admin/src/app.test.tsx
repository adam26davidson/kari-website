import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "./app";
import { Admin } from "./admin";

// App is the outermost frame and nothing else since #592: the shared
// `.whole-page` box and the error boundary around the admin section. The
// section has its own tests (admin.test.tsx) and the shell inside it has
// its own (components/app-shell/); stub the section out here.
vi.mock("./admin", () => ({ Admin: vi.fn() }));

function renderApp() {
  return render(
    <MemoryRouter basename="/admin" initialEntries={["/admin/home"]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(Admin).mockImplementation(() => <div>Admin section stub</div>);
});

describe("the admin app's frame", () => {
  it("renders the admin section", () => {
    renderApp();
    expect(screen.getByText("Admin section stub")).toBeInTheDocument();
  });

  // `.whole-page` is the shared fixed-height box (`100dvh`, with a `100vh`
  // fallback — #558). It is what the shell's one scroll container measures
  // itself against, and losing it would give the document a second scroller
  // and strand the sidebar off the top of a phone.
  it("uses the shared fixed-height page frame", () => {
    const { container } = renderApp();
    expect(container.querySelector(".whole-page")).not.toBeNull();
  });

  // A page that throws must not leave a maintainer staring at a blank
  // document with no way back. The boundary resets on navigation, which is
  // why it wraps the section rather than the router.
  it("catches a failure inside the section", () => {
    // React logs the caught error; the test would otherwise fail on the
    // noise rather than on the assertion.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Admin).mockImplementation(() => {
      throw new Error("the admin section exploded");
    });

    renderApp();

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
