import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Toaster } from "./components/ui/toaster";
import { Button } from "./components/ui/button";
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

/**
 * One toast at a time, always. Sonner stacks by default, and the e2e
 * journeys read a save's acknowledgement off `.admin-toast` as a single
 * element — a second toast arriving while the first is still up would make
 * that locator match two elements and fail Playwright's strict mode. Reusing
 * one id makes sonner UPDATE the toast that is showing instead of adding to
 * it, which is also the behaviour this provider had before #592: the timer
 * that cleared the old single toast was restarted by each new message.
 */
const TOAST_ID = "admin-toast";

/**
 * Owns the loading/confirmation/toast state for the admin area and renders
 * the corresponding chrome next to its children.
 *
 * The three surfaces are shadcn/ui since #592 — a Radix `AlertDialog` for
 * the confirmation, sonner for the toast, and a plain fixed overlay for the
 * blocking "Saving..." state — but the context this publishes has not
 * changed, so its twelve consumers ask for them exactly as before.
 */
export function AdminUiProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<Loading>({
    isLoading: false,
    message: "",
  });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

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
  const notify = useCallback<Notify>((message, type = "success") => {
    if (type === "error") {
      toast.error(message, { id: TOAST_ID });
    } else {
      toast.success(message, { id: TOAST_ID });
    }
  }, []);

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

  /**
   * Closes the dialog, running the callback the caller gave for the answer
   * chosen. `onNo` is optional — a caller that only cares about Yes passes
   * nothing and gets nothing run, which is the contract useAdminUi states.
   */
  const answerWith = (callback?: () => void) => () => {
    callback?.();
    setConfirmation(null);
  };

  return (
    <AdminUiContext.Provider value={value}>
      {children}
      <AlertDialog open={confirmation !== null}>
        {confirmation && (
          // `.admin-confirmation` is the e2e hook the journeys answer the
          // dialog through; the look is Tailwind.
          //
          // Escape is handled here rather than through Radix's
          // `onOpenChange` because backing out is the same answer as
          // saying No and has to RUN the caller's onNo: the
          // unsaved-changes guard leaves a navigation blocked until it is
          // told which way the question went. A press OUTSIDE the dialog
          // is ignored — Radix's alert dialog does that for us, and it is
          // the right call: this is a question that has to be answered.
          <AlertDialogContent
            className="admin-confirmation"
            onEscapeKeyDown={answerWith(confirmation.onNo)}
          >
            <AlertDialogTitle>{confirmation.message}</AlertDialogTitle>
            {/* Radix asks every alert dialog for a description, and it is
                worth having: it names the two ways out for someone who is
                hearing the dialog rather than seeing it. Visually it would
                only repeat the buttons an inch below. */}
            <AlertDialogDescription className="sr-only">
              Choose Yes to go ahead, or No to leave things as they are.
            </AlertDialogDescription>
            <div className="mt-4 flex flex-row justify-end gap-3">
              {/* No goes through Radix's Cancel primitive, which is what
                  makes it the element the dialog focuses on open: Content
                  cancels the default open-autofocus and focuses whatever
                  Cancel registered. So the safe answer is where focus
                  lands and what a stray Enter gives, and the keyboard user
                  who opened this with Enter on a row's Delete is not left
                  focused on that Delete, behind the overlay and inside the
                  tree Radix has just marked aria-hidden.

                  `asChild` hands the primitive's props — including the ref
                  it needs to focus this on open, a plain prop under React
                  19 — to the Button, which spreads them onto its <button>.
                  Cancel also asks the dialog to close, which is inert here
                  — this AlertDialog is controlled by `confirmation` with no
                  `onOpenChange` — leaving the `onClick` below as the one
                  thing that answers the question.

                  `admin-button` on both answers styles nothing; it is the
                  hook `confirmDialog` in e2e/helpers.ts clicks them by. */}
              <AlertDialogCancel asChild>
                <Button
                  variant="secondary"
                  className="admin-button"
                  onClick={answerWith(confirmation.onNo)}
                >
                  No
                </Button>
              </AlertDialogCancel>
              <Button
                className="admin-button"
                onClick={answerWith(confirmation.onYes)}
              >
                Yes
              </Button>
            </div>
          </AlertDialogContent>
        )}
      </AlertDialog>
      {loading.isLoading && (
        // Fixed, so it covers the page whatever the content column has
        // been scrolled to. `.admin-loading` is what e2e/helpers.ts waits
        // to disappear before asserting on a list.
        <div className="admin-loading fixed inset-0 z-[1001] flex items-center justify-center bg-foreground/40">
          <div className="rounded-xl border border-border bg-card px-8 py-4 font-sans text-base text-foreground shadow-[0_18px_48px_rgba(74,62,40,0.22)]">
            {loading.message}
          </div>
        </div>
      )}
      <Toaster />
    </AdminUiContext.Provider>
  );
}
