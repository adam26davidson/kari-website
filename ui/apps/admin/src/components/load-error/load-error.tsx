import { CircleAlert } from "lucide-react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown when an admin page fails to load its data, with a Retry action. It
 * replaces the editor entirely: editing must never start from unloaded
 * data, or a save would overwrite the real content.
 *
 * An admin fork of the shared `LoadError` (#832), not a restyle of it: the
 * shared one still dresses three public pages, whose appearance is out of
 * scope for the admin brief. Forking is also the only way to leave the
 * shared notice-card rule behind — `.loading, .load-error, .error-boundary`
 * in packages/shared/src/styles/index.css is unlayered, so it outranks
 * every Tailwind utility, and a root still carrying `load-error` would wear
 * the public site's 80px drop, 8px radius and black shadow on top of this
 * Card.
 *
 * `admin-load-error` styles nothing — do not give it a rule. It is the hook
 * e2e/helpers.ts and e2e/admin-whats-on-test.spec.ts find this notice by,
 * the same convention as `admin-data-list-item`.
 *
 * Calm rather than alarmed (docs/ui-design-brief.md §1, §3): the filled
 * maroon block is for a warning inside a page she keeps using, whereas this
 * one IS the page, so only the mark carries the colour — the same
 * `CircleAlert` the failed-save toast shows.
 */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <Card
      role="alert"
      className="admin-load-error mx-auto flex w-full max-w-[560px] flex-col gap-4 p-5 sm:p-6"
    >
      <div className="flex flex-row items-start gap-3">
        <CircleAlert
          aria-hidden="true"
          className="text-destructive mt-0.5 size-5 shrink-0"
        />
        <div className="flex flex-col gap-1">
          <p className="text-foreground font-sans text-sm leading-relaxed">
            {message}
          </p>
          <p className="text-muted-foreground font-sans text-sm leading-relaxed">
            Nothing on the site has changed — try again in a moment.
          </p>
        </div>
      </div>
      <Button onClick={onRetry}>Retry</Button>
    </Card>
  );
}
