import { useCallback, useEffect, useMemo, useState } from "react";
import "./admin.css";
import { AdminButton } from "./components/admin-button/admin-button";
import { AdminUi, AdminUiContext, Notify } from "./admin-ui-context";

interface Loading {
  isLoading: boolean;
  message: string;
}

interface Confirmation {
  message: string;
  onYes: () => void;
  onNo?: () => void;
}

interface Notification {
  message: string;
  type: "success" | "error";
}

/**
 * Owns the loading/confirmation/toast state for the admin area and renders
 * the corresponding overlays next to its children (inside .admin-content,
 * whose positioning the overlay CSS relies on).
 */
export function AdminUiProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<Loading>({
    isLoading: false,
    message: "",
  });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  const showLoading = useCallback(
    (message: string) => setLoading({ isLoading: true, message }),
    [],
  );
  const hideLoading = useCallback(
    () => setLoading({ isLoading: false, message: "" }),
    [],
  );
  const confirm = useCallback(
    (message: string, onYes: () => void, onNo?: () => void) =>
      setConfirmation({ message, onYes, onNo }),
    [],
  );
  const notify = useCallback<Notify>(
    (message, type = "success") => setNotification({ message, type }),
    [],
  );

  const value = useMemo<AdminUi>(
    () => ({
      isLoading: loading.isLoading,
      showLoading,
      hideLoading,
      confirm,
      notify,
    }),
    [loading.isLoading, showLoading, hideLoading, confirm, notify],
  );

  return (
    <AdminUiContext.Provider value={value}>
      {confirmation && (
        <div className="admin-confirmation">
          <div className="admin-confirmation-dialog">
            {confirmation.message}
            <div className="admin-confirmation-options">
              <AdminButton
                onClick={() => {
                  confirmation.onYes();
                  setConfirmation(null);
                }}
              >
                Yes
              </AdminButton>
              <AdminButton
                onClick={() => {
                  confirmation.onNo?.();
                  setConfirmation(null);
                }}
              >
                No
              </AdminButton>
            </div>
          </div>
        </div>
      )}
      {loading.isLoading && (
        <div className="admin-loading">
          <div className="admin-loading-message">{loading.message}</div>
        </div>
      )}
      {notification && (
        <div className={`admin-toast admin-toast-${notification.type}`}>
          {notification.message}
        </div>
      )}
      {children}
    </AdminUiContext.Provider>
  );
}
