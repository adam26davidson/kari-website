import { Mock, vi } from "vitest";
import { act, render } from "@testing-library/react";
import {
  createMemoryRouter,
  DataRouter,
  RouterProvider,
  To,
} from "react-router";
import { AdminUi, AdminUiContext } from "./admin-ui-context";

/** AdminUi with every function mocked, for asserting page behavior. */
export interface AdminUiMock extends AdminUi {
  showLoading: Mock<(message: string) => void>;
  hideLoading: Mock<() => void>;
  confirm: Mock<
    (message: string, onYes: () => void, onNo?: () => void) => void
  >;
  notify: Mock<(message: string, type?: "success" | "error") => void>;
}

export function mockAdminUi(): AdminUiMock {
  return {
    isLoading: false,
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    confirm: vi.fn(),
    notify: vi.fn(),
  };
}

/** Renders ui inside a mocked AdminUiContext and returns the mocks. */
export function renderWithAdminUi(
  ui: React.ReactElement,
  adminUi: AdminUiMock = mockAdminUi(),
) {
  const utils = render(
    <AdminUiContext.Provider value={adminUi}>{ui}</AdminUiContext.Provider>,
  );
  return { ...utils, adminUi };
}

/**
 * Renders an admin page the way the admin shell mounts it: on a data
 * router (required by useBlocker) at its /admin/<section>/:id? route,
 * inside a mocked AdminUiContext. Returns the router for URL assertions
 * and history navigation (router.navigate(-1) is the browser back button).
 */
export function renderAdminPage(
  ui: React.ReactElement,
  path: string,
  initialEntry: string = path.replace("/:id?", ""),
  adminUi: AdminUiMock = mockAdminUi(),
) {
  const router = createMemoryRouter(
    [
      {
        path,
        element: (
          <AdminUiContext.Provider value={adminUi}>
            {ui}
          </AdminUiContext.Provider>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, adminUi, router };
}

/**
 * Navigates the test router, the way a real in-app navigation would.
 *
 * The extra `act` before the navigation is load-bearing, not belt-and-
 * braces. react-router registers the unsaved-changes predicate through a
 * PASSIVE effect (`useBlocker` -> `router.getBlocker(key, fn)`), and that
 * effect re-runs whenever `isDirty` changes because the predicate is a
 * fresh closure each render. So between "the page became clean" and "the
 * router knows it is clean" there is one pending passive effect.
 *
 * A real user never sees that gap: React flushes pending passive effects
 * before it dispatches the next discrete event, so the click that follows
 * a save or an undo always meets the fresh predicate. A test calling
 * `router.navigate()` directly is not a React event and forces no such
 * flush, so it can hit the STALE predicate and be blocked — the guard
 * asking to discard changes that were already saved. Flushing first is
 * what reproduces the browser's ordering.
 *
 * This only became visible on React 19 (issue #534), which defers passive
 * effects more aggressively than 18 did; the same tests were quietly
 * racing before, and won ~100% of the time.
 */
export async function navigateInTest(router: DataRouter, to: To | number) {
  await act(async () => {});
  await act(async () => {
    // A number is a history delta: navigate(-1) is the back button.
    await (typeof to === "number" ? router.navigate(to) : router.navigate(to));
  });
}

/**
 * Runs the onYes callback of the most recent confirm() call, exactly as
 * the provider's Yes button would.
 */
export async function answerYes(adminUi: AdminUiMock) {
  const call = adminUi.confirm.mock.calls.at(-1);
  if (!call) throw new Error("confirm() was never called");
  await act(async () => {
    call[1]();
  });
}

/**
 * Runs the onNo callback of the most recent confirm() call, exactly as
 * the provider's No button would. (Callers that pass no onNo are simply
 * not run — same as the provider.)
 */
export async function answerNo(adminUi: AdminUiMock) {
  const call = adminUi.confirm.mock.calls.at(-1);
  if (!call) throw new Error("confirm() was never called");
  await act(async () => {
    call[2]?.();
  });
}
