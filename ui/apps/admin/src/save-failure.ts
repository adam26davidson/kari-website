/**
 * The admin's two save-failure toasts (#830). Each says what happened and
 * what to do next (design brief, principle 5), and each has to be TRUE on
 * every path that raises it — so there are two, not one.
 */

import { BackgroundImageError } from "@kari/shared/utils/background-image";
import { UploadTooLargeError } from "@kari/shared/utils/upload-size";

/**
 * A save from an editor failed. Every editor keeps its form open with her
 * edits in it after a failed save, so the toast can promise that.
 */
export const SAVE_FAILED_MESSAGE =
  "Couldn't save — the site may be offline. Your changes are still here; " +
  "try again in a moment.";

/**
 * A one-click list action — adding, deleting or reordering — failed. There
 * is no form and no edit to keep: the list simply stays as it was.
 */
export const LIST_CHANGE_FAILED_MESSAGE =
  "Couldn't make that change — the site may be offline. Nothing has " +
  "changed; try again in a moment.";

/**
 * The toast for a failed save: `error`'s own message when it is one of the
 * errors that carry words she can act on — the server refused the photo as
 * too big, or the background photo is unusable — and `fallback` otherwise.
 * Both are TRUE on the path that raised them (the rule above), so they are
 * shown verbatim; anything else may be a network or server fault whose
 * message is not meant for her.
 */
export function saveFailureMessage(
  error: unknown,
  fallback: string = SAVE_FAILED_MESSAGE,
): string {
  if (
    error instanceof UploadTooLargeError ||
    error instanceof BackgroundImageError
  ) {
    return error.message;
  }
  return fallback;
}
