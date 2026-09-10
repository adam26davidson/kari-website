import { CircleAlert, CircleCheck } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/**
 * The toast surface, shadcn/ui's sonner wrapper (#592) styled to the
 * boards: a small warm card, bottom-right, with a green tick for a save and
 * a maroon ring for a failure.
 *
 * `unstyled` because sonner's own look is a grey system toast and this one
 * has to belong to the paper theme; everything it would have drawn is
 * declared in `classNames` instead.
 *
 * `.admin-toast` is the class the e2e journeys read the message off
 * (`expect(page.locator(".admin-toast")).toHaveText(...)`). It stays on the
 * toast itself, and `AdminUiProvider` shows at most one at a time, so that
 * locator can never match two elements.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        className: "admin-toast",
        duration: 3000,
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-xl border border-border " +
            "bg-card px-4 py-3 font-sans text-sm text-foreground " +
            "shadow-[0_10px_28px_rgba(74,62,40,0.18)]",
          title: "font-normal",
          icon: "flex shrink-0 items-center",
          // Only the ring changes on a failure — the message itself stays
          // Ink, because a sentence set in the destructive colour reads as
          // an alarm rather than as an explanation.
          error: "border-destructive/40",
        },
      }}
      icons={{
        success: <CircleCheck className="size-5 text-primary" />,
        error: <CircleAlert className="size-5 text-destructive" />,
      }}
    />
  );
}
