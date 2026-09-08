import { AlertDialog as Primitive } from "radix-ui";
import { cn } from "./cn";

/**
 * shadcn/ui's AlertDialog, vendored (#592) and trimmed to the four parts
 * the admin's one confirmation dialog uses.
 *
 * Radix is what makes this a real dialog rather than a div that looks like
 * one: `role="alertdialog"`, focus moved in and restored on close, the rest
 * of the page inert to a screen reader, Escape to dismiss, and a pointer
 * press outside deliberately IGNORED — an alert dialog asks a question that
 * has to be answered, so there is no "click away to make it go".
 *
 * `Action` and `Cancel` are deliberately not vendored. The buttons in the
 * dialog are `AdminButton`s, so they carry the same look and the same
 * `.admin-button` hook as every other button in the app, and the provider
 * that owns the dialog already owns the state the two primitives exist to
 * close.
 */
export function AlertDialog(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="alert-dialog" {...props} />;
}

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-foreground/40"
      />
      <Primitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md " +
            "-translate-x-1/2 -translate-y-1/2 gap-2 rounded-xl border " +
            "border-border bg-card p-7 font-sans text-foreground " +
            "shadow-[0_18px_48px_rgba(74,62,40,0.22)]",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Title>) {
  return (
    <Primitive.Title
      data-slot="alert-dialog-title"
      // Deliberately not the boards' Newsreader italic: this heading is a
      // question about something the admin is in the middle of doing, and
      // the display face is for the calm, welcoming parts of the app
      // (greetings, page titles) rather than for the moment she is being
      // asked to confirm a delete.
      className={cn("text-base font-medium text-balance", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Description>) {
  return (
    <Primitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
