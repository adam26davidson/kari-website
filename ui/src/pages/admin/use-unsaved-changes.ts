import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useAdminUi } from "./admin-ui-context";

/**
 * Guards unsaved edits behind the admin confirmation dialog: while isDirty,
 * any in-app navigation (browser back, close button, menu link) is held
 * until the user confirms discarding, and tab close/refresh triggers the
 * browser's native leave prompt. Requires a data router (createBrowserRouter).
 */
export function useUnsavedChanges(isDirty: boolean) {
  const { confirm } = useAdminUi();
  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    confirm(
      "You have unsaved changes. Discard them?",
      () => blocker.proceed(),
      () => blocker.reset(),
    );
  }, [blocker, confirm]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Asks the browser to show its native "leave site?" prompt.
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);
}
