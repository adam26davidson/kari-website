import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { AdminUiContext } from "./admin-ui-context";
import {
  answerNo,
  answerYes,
  mockAdminUi,
  AdminUiMock,
} from "./admin-ui-test-helpers";
import { useUnsavedChanges } from "./use-unsaved-changes";

// A minimal editor-like consumer: reports dirty to the hook and offers an
// in-app navigation away, exactly like a page's close button or a menu
// link would.
function Editor({ dirty }: { dirty: boolean }) {
  const navigateWithoutGuard = useUnsavedChanges(dirty);
  return (
    <div>
      <div>editor-view</div>
      <Link to="/list">leave</Link>
      <button onClick={() => navigateWithoutGuard("/list")}>
        save-and-leave
      </button>
    </div>
  );
}

function renderAt(
  dirty: boolean,
  adminUi: AdminUiMock = mockAdminUi(),
): AdminUiMock {
  const router = createMemoryRouter(
    [
      { path: "/editor", element: <Editor dirty={dirty} /> },
      { path: "/list", element: <div>list-view</div> },
    ],
    { initialEntries: ["/editor"] },
  );
  render(
    <AdminUiContext.Provider value={adminUi}>
      <RouterProvider router={router} />
    </AdminUiContext.Provider>,
  );
  return adminUi;
}

describe("useUnsavedChanges in-app navigation", () => {
  it("lets navigation through untouched while clean", async () => {
    const adminUi = renderAt(false);

    fireEvent.click(screen.getByRole("link", { name: "leave" }));

    expect(await screen.findByText("list-view")).toBeInTheDocument();
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("blocks navigation while dirty and asks for confirmation", async () => {
    const adminUi = renderAt(true);

    fireEvent.click(screen.getByRole("link", { name: "leave" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    // Still on the editor — nothing navigated yet.
    expect(screen.getByText("editor-view")).toBeInTheDocument();
    expect(screen.queryByText("list-view")).toBeNull();
  });

  it("proceeds with the blocked navigation on Yes", async () => {
    const adminUi = renderAt(true);
    fireEvent.click(screen.getByRole("link", { name: "leave" }));

    await answerYes(adminUi);

    expect(await screen.findByText("list-view")).toBeInTheDocument();
  });

  it("lets a guard-bypassing navigation through even while dirty", async () => {
    // Programmatic close-after-save: the just-saved state is only
    // reflected on the next render, so the page navigates via the
    // bypass instead of waiting out the stale dirty flag.
    const adminUi = renderAt(true);

    fireEvent.click(screen.getByRole("button", { name: "save-and-leave" }));

    expect(await screen.findByText("list-view")).toBeInTheDocument();
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("stays put on No and blocks the next attempt again", async () => {
    const adminUi = renderAt(true);
    fireEvent.click(screen.getByRole("link", { name: "leave" }));

    await answerNo(adminUi);

    expect(screen.getByText("editor-view")).toBeInTheDocument();

    // The blocker was reset, so a second attempt is blocked afresh
    // rather than slipping through.
    fireEvent.click(screen.getByRole("link", { name: "leave" }));
    expect(adminUi.confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText("editor-view")).toBeInTheDocument();
  });
});

describe("useUnsavedChanges tab close / refresh", () => {
  it("prompts on beforeunload while dirty", () => {
    renderAt(true);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not prompt on beforeunload while clean", () => {
    renderAt(false);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
