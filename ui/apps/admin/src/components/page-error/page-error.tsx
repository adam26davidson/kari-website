import { isChunkLoadError } from "@kari/shared/components/error-boundary/lazy-with-retry";
import { LoadError } from "../load-error/load-error";

interface PageErrorProps {
  /** What the route error boundary caught. */
  error: unknown;
}

/**
 * The admin's route error boundary fallback (#949): the same calm card a
 * failed load shows, with Reload as its one action, instead of the shared
 * `.error-boundary` notice — whose unlayered rule would outrank this
 * Card's utilities, which is why no element here carries that class.
 *
 * The boundary wraps the whole admin section, outside the shell, so when
 * this shows there is no sidebar and no `.admin-content` gutter around
 * it; the wrapper gives the card the shell's own gutter (admin.css) so it
 * never sits flush against the edge of the page.
 */
export function PageError({ error }: PageErrorProps) {
  // A failed lazy-chunk fetch usually means a redeploy replaced the files
  // this tab still points at; say so instead of the generic message.
  const chunk = isChunkLoadError(error);
  return (
    <div className="w-full px-[18px] py-8 sm:px-8">
      <LoadError
        message={
          chunk
            ? "The site may have been updated since this page was opened."
            : "Something went wrong showing this page."
        }
        nextStep={
          chunk
            ? "Reload to pick up the latest version — nothing on the site " +
              "has changed."
            : "Nothing on the site has changed — reload the page to carry on."
        }
        actionLabel="Reload"
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
