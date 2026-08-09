import { Mock, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AdminUi, AdminUiContext } from "./admin-ui-context";

/** AdminUi with every function mocked, for asserting page behavior. */
export interface AdminUiMock extends AdminUi {
  showLoading: Mock<(message: string) => void>;
  hideLoading: Mock<() => void>;
  confirm: Mock<(message: string, onYes: () => void) => void>;
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
 * Runs the onYes callback of the most recent confirm() call, exactly as
 * the provider's Yes button would. (Declining is just not calling onYes —
 * the provider owns the No button, and its own tests cover it.)
 */
export async function answerYes(adminUi: AdminUiMock) {
  const call = adminUi.confirm.mock.calls.at(-1);
  if (!call) throw new Error("confirm() was never called");
  await act(async () => {
    call[1]();
  });
}
