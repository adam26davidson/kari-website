import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAdminUi } from "./admin-ui-context";
import { AdminUiProvider } from "./admin-ui-provider";

// The two callbacks a confirmation carries, as spies rather than as toasts.
// Sonner's store is a module singleton, so a toast raised in one test is
// still in it when the next one mounts a fresh Toaster — which would make
// "onYes never ran" pass or fail on what the previous test did.
const onYes = vi.fn();
const onNo = vi.fn();

beforeEach(() => {
  onYes.mockReset();
  onNo.mockReset();
});

// A consumer exposing every context function as a button, so the tests
// drive the provider exactly the way the admin pages do.
function Consumer() {
  const { isLoading, showLoading, hideLoading, confirm, notify } =
    useAdminUi();
  return (
    <div>
      <div>isLoading: {String(isLoading)}</div>
      <button onClick={() => showLoading("Working...")}>show-loading</button>
      <button onClick={() => hideLoading()}>hide-loading</button>
      <button onClick={() => confirm("Really do it?", onYes)}>ask</button>
      <button onClick={() => confirm("Discard changes?", onYes, onNo)}>
        ask-with-no
      </button>
      <button onClick={() => notify("saved")}>notify-success</button>
      <button onClick={() => notify("broke", "error")}>notify-error</button>
    </div>
  );
}

function renderProvider() {
  const user = userEvent.setup();
  render(
    <AdminUiProvider>
      <Consumer />
    </AdminUiProvider>,
  );
  return {
    user,
    /** Press one of the consumer's buttons by its label. */
    press: (label: string) => user.click(screen.getByText(label)),
  };
}

describe("AdminUiProvider loading overlay", () => {
  it("shows the message while loading and hides it after", async () => {
    const { press } = renderProvider();
    expect(screen.getByText("isLoading: false")).toBeInTheDocument();

    await press("show-loading");
    expect(screen.getByText("Working...")).toBeInTheDocument();
    expect(screen.getByText("isLoading: true")).toBeInTheDocument();

    await press("hide-loading");
    expect(screen.queryByText("Working...")).toBeNull();
    expect(screen.getByText("isLoading: false")).toBeInTheDocument();
  });

  // `.admin-loading` is what e2e/helpers.ts waits to disappear before it
  // asserts on a list, so it is a contract rather than a leftover class.
  it("marks the overlay with the class the e2e suite waits on", async () => {
    const { press } = renderProvider();
    await press("show-loading");
    expect(document.querySelector(".admin-loading")).not.toBeNull();
  });
});

describe("AdminUiProvider confirmation dialog", () => {
  it("runs onYes and closes on Yes", async () => {
    const { user, press } = renderProvider();
    await press("ask");
    expect(screen.getByText("Really do it?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(screen.queryByText("Really do it?")).toBeNull();
    expect(onYes).toHaveBeenCalledOnce();
  });

  it("closes without running onYes on No", async () => {
    const { user, press } = renderProvider();
    await press("ask");

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByText("Really do it?")).toBeNull();
    expect(onYes).not.toHaveBeenCalled();
  });

  it("runs onNo (when given) and closes on No", async () => {
    const { user, press } = renderProvider();
    await press("ask-with-no");

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onNo).toHaveBeenCalledOnce();
    expect(onYes).not.toHaveBeenCalled();
  });

  it("does not run onNo on Yes", async () => {
    const { user, press } = renderProvider();
    await press("ask-with-no");

    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(onYes).toHaveBeenCalledOnce();
    expect(onNo).not.toHaveBeenCalled();
  });

  // Backing out with Escape is the same answer as No, and it has to RUN
  // onNo rather than merely close: the unsaved-changes guard leaves the
  // navigation blocked until it is told which way the question went.
  it("treats Escape as No", async () => {
    const { user, press } = renderProvider();
    await press("ask-with-no");

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onNo).toHaveBeenCalledOnce();
  });

  it("survives Escape on a confirmation that was given no onNo", async () => {
    const { user, press } = renderProvider();
    await press("ask");

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Really do it?")).toBeNull();
    expect(onYes).not.toHaveBeenCalled();
  });

  // A real alert dialog, not a div that looks like one: the role is what
  // makes a screen reader interrupt with it, and the question is what it
  // announces.
  it("is an alert dialog named by the question it asks", async () => {
    const { press } = renderProvider();
    await press("ask");

    expect(
      screen.getByRole("alertdialog", { name: "Really do it?" }),
    ).toBeInTheDocument();
  });

  // The e2e journeys answer every delete through `.admin-confirmation`, and
  // click Yes/No inside it by `.admin-button`.
  it("keeps the hooks the e2e journeys answer it through", async () => {
    const { press } = renderProvider();
    await press("ask");

    const dialog = document.querySelector(".admin-confirmation");
    expect(dialog).not.toBeNull();
    expect(
      [...dialog!.querySelectorAll(".admin-button")].map((b) => b.textContent),
    ).toEqual(["No", "Yes"]);
  });
});

describe("AdminUiProvider toast", () => {
  it("shows a success toast", async () => {
    const { press } = renderProvider();
    await press("notify-success");
    expect(await screen.findByText("saved")).toBeInTheDocument();
  });

  it("shows an error toast", async () => {
    const { press } = renderProvider();
    await press("notify-error");
    expect(await screen.findByText("broke")).toBeInTheDocument();
  });

  // One toast at a time. Sonner stacks by default, and the e2e journeys
  // read a save's acknowledgement off `.admin-toast` as a SINGLE element —
  // a second toast arriving while the first is up would make that locator
  // match two and fail Playwright's strict mode.
  it("replaces the toast that is showing rather than stacking on it", async () => {
    const { press } = renderProvider();
    await press("notify-success");
    await screen.findByText("saved");

    await press("notify-error");

    await waitFor(() => {
      expect(screen.getByText("broke")).toBeInTheDocument();
    });
    expect(screen.queryByText("saved")).toBeNull();
    expect(document.querySelectorAll(".admin-toast")).toHaveLength(1);
  });
});

describe("useAdminUi", () => {
  it("throws outside an AdminUiProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useAdminUi must be used inside an AdminUiProvider",
    );
  });
});
