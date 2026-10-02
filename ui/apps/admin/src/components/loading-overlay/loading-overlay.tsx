import { LoaderCircle } from "lucide-react";

interface LoadingOverlayProps {
  message: string;
  /** 0-1 fraction of a transfer; omitted for a wait of unknown length. */
  progress?: number;
}

/**
 * The blocking overlay the admin shows while it saves or loads: a dimmed
 * page and one small card saying what is happening, with something on it
 * that visibly moves so a long wait never reads as a hang (#712).
 *
 * One indicator at a time (docs/ui-design-brief.md §1): a turning ring
 * while the length of the wait is unknown, or a filling bar with its
 * percentage when the caller knows how far along it is. The ring stands
 * still for anyone who has asked their system for reduced motion; the
 * message, and the bar when there is one, still carry the state.
 *
 * Only the message sits in the `role="status"` live region, which changes
 * at phase boundaries. The percentage changes many times a second, so it
 * is left to the progressbar's `aria-valuenow`, which screen readers read
 * at their own pace, instead of being re-announced on every tick.
 *
 * `admin-loading` must stay on the OUTERMOST element and styles nothing:
 * it is the hook `waitForIdle` in e2e/helpers.ts waits to be hidden.
 */
export function LoadingOverlay({ message, progress }: LoadingOverlayProps) {
  return (
    // Fixed, so it covers the page whatever the content column has been
    // scrolled to.
    <div className="admin-loading fixed inset-0 z-[1001] flex items-center justify-center bg-foreground/40">
      <div className="mx-4 flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card px-8 py-4 text-center font-sans text-base text-foreground shadow-[0_18px_48px_rgba(74,62,40,0.22)]">
        <div role="status">{message}</div>
        {progress === undefined ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin text-primary motion-reduce:animate-none"
          />
        ) : (
          <ProgressBar percent={toPercent(progress)} />
        )}
      </div>
    </div>
  );
}

/** A 0-1 fraction as a whole percentage, kept within 0-100. */
function toPercent(fraction: number): number {
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <>
      <div
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-56 max-w-full overflow-hidden rounded-full bg-muted"
      >
        {/* Inline width: Tailwind cannot generate a class for a value only
            known at run time. */}
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        {percent}%
      </span>
    </>
  );
}
