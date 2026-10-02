import { createContext, useContext } from "react";

export type Notify = (message: string, type?: "success" | "error") => void;

/** The shared admin chrome: loading overlay, confirmation dialog, toast. */
export interface AdminUi {
  /** True while the loading overlay is up (mirrors show/hideLoading). */
  isLoading: boolean;
  /**
   * Shows the blocking overlay. `progress` is a 0-1 fraction of a transfer,
   * drawn as a filling bar; omit it for a wait of unknown length.
   */
  showLoading: (message: string, progress?: number) => void;
  hideLoading: () => void;
  /**
   * Shows a Yes/No dialog; onYes runs only when Yes is chosen, onNo (if
   * given) only when No is chosen.
   */
  confirm: (message: string, onYes: () => void, onNo?: () => void) => void;
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
