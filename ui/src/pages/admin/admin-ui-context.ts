import { createContext, useContext } from "react";

export type Notify = (message: string, type?: "success" | "error") => void;

/** The shared admin chrome: loading overlay, confirmation dialog, toast. */
export interface AdminUi {
  /** True while the loading overlay is up (mirrors show/hideLoading). */
  isLoading: boolean;
  showLoading: (message: string) => void;
  hideLoading: () => void;
  /** Shows a Yes/No dialog; onYes runs only when Yes is chosen. */
  confirm: (message: string, onYes: () => void) => void;
  notify: Notify;
}

// Exported so tests can render a consumer against a mocked UI surface;
// application code should use AdminUiProvider + useAdminUi.
export const AdminUiContext = createContext<AdminUi | null>(null);

export function useAdminUi(): AdminUi {
  const value = useContext(AdminUiContext);
  if (!value) {
    throw new Error("useAdminUi must be used inside an AdminUiProvider");
  }
  return value;
}
