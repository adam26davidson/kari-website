import { Mock, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AdminUi, AdminUiContext } from "./admin-ui-context";

/** AdminUi with every function mocked, for asserting page behavior. */
export interface AdminUiMock extends AdminUi {
  showLoading: Mock<(message: string) => void>;
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
