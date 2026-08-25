import { useCallback, useEffect, useRef } from "react";
import { To, useBlocker, useNavigate } from "react-router";
import { useAdminUi } from "./admin-ui-context";

/**
 * Guards unsaved edits behind the admin confirmation dialog: while isDirty,
 * any in-app navigation (browser back, close button, menu link) is held
 * until the user confirms discarding, and tab close/refresh triggers the
 * browser's native leave prompt. Requires a data router (createBrowserRouter).
 *
 * Returns a navigate function that skips the guard once — for programmatic
 * close-after-save, where the freshly saved (clean) state is only reflected
 * on the next render and isDirty is still stale.
 */
export function useUnsavedChanges(isDirty: boolean): (to: To) => void {
  const { confirm } = useAdminUi();
  const navigate = useNavigate();
  const bypassRef = useRef(false);
  const blocker = useBlocker(() => isDirty && !bypassRef.current);

  // A bypass only spans the navigation it was requested for; clear it as
  // soon as the next render commits.
  useEffect(() => {
    bypassRef.current = false;
  });

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

  return useCallback(
    (to: To) => {
      bypassRef.current = true;
      navigate(to);
    },
    [navigate],
  );
}
