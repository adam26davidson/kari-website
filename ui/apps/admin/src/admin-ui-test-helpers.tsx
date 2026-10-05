import { expect, Mock, vi } from "vitest";
import { useContext } from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  DataRouter,
  RouterProvider,
  To,
} from "react-router";
import { AdminUi, AdminUiContext } from "./admin-ui-context";
import {
  AssistantContext,
  AssistantContextValue,
  AssistantSubject,
} from "./assistant/assistant-context";
import { AssistantProvider } from "./assistant/assistant-provider";

/** AdminUi with every function mocked, for asserting page behavior. */
export interface AdminUiMock extends AdminUi {
  showLoading: Mock<(message: string, progress?: number) => void>;
  hideLoading: Mock<() => void>;
  confirm: Mock<(message: string, onYes: () => void, onNo?: () => void) => void>;
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
 * inside a mocked AdminUiContext and the assistant provider the shell wraps
 * `<Routes>` in. Returns the router for URL assertions and history
 * navigation (router.navigate(-1) is the browser back button), and
 * `subject` — what the page has told the helper is on her screen.
 */
export function renderAdminPage(
  ui: React.ReactElement,
  path: string,
  initialEntry: string = path.replace("/:id?", ""),
  adminUi: AdminUiMock = mockAdminUi(),
) {
  // Mutated by the probe below on every render, so a test reads what the
  // page is publishing NOW rather than what it published when it mounted.
  const subject: { current: AssistantSubject } = { current: {} };
  function AssistantSubjectProbe() {
    // The provider below is mounted right here, so the context is never
    // null — asserted rather than branched on, because a fallback no test
    // can reach would be an untestable branch against the coverage ratchet.
    const context = useContext(AssistantContext) as AssistantContextValue;
    subject.current = context.subject;
    return null;
  }
  const router = createMemoryRouter(
    [
      {
        path,
        element: (
          <AdminUiContext.Provider value={adminUi}>
            <AssistantProvider>
              {ui}
              <AssistantSubjectProbe />
            </AssistantProvider>
          </AdminUiContext.Provider>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, adminUi, router, subject };
}

/**
 * Navigates the test router, the way a real in-app navigation would.
 *
 * The empty `act` first is a microtask yield that lets already-scheduled
 * React work settle; it is NOT a guarantee that a render the test just
 * triggered has committed. (An earlier version of this comment claimed
 * React flushes pending passive effects before the next discrete event —
 * it does not, #835.) A test that navigates after async work, such as a
 * save, must first await a post-commit signal of the state it depends on
 * — usually `waitUntilClean`.
 */
export async function navigateInTest(router: DataRouter, to: To | number) {
  await act(async () => {});
  await act(async () => {
    // The two arms look identical on purpose: `navigate` is overloaded
    // (a path, or a history delta -- navigate(-1) is the back button) and
    // TypeScript will not resolve an overload against the `To | number`
    // union, so the call has to be made once per narrowed type.
    await (typeof to === "number" ? router.navigate(to) : router.navigate(to));
  });
}

/**
 * Waits until the page has committed its clean (saved) state, for a test
 * that saves and then leaves.
 *
 * A success toast is NOT that signal: `notify("... saved")` is called in
 * the same continuation as the setState that makes the page clean, so it
 * fires before that render has even started. The assistant subject is:
 * every page publishes `{ dirty }` from a passive effect declared right
 * after its `useUnsavedChanges(dirty)` call, and a component's passive
 * effects run in hook order, so once the subject says clean, the clean
 * render has committed and the guard's effects have flushed too. That
 * hook order is load-bearing — keep `useUnsavedChanges` first in a page.
 *
 * Asserts on `dirty` alone: other subject fields (a haiku's title) change
 * with the edit itself.
 */
export async function waitUntilClean(subject: { current: AssistantSubject }) {
  await waitFor(() => expect(subject.current.dirty).toBe(false));
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
