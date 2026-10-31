import type { UploadProgress } from "@kari/shared/services/http";

/** What the loading overlay says, and shows, at one point of an upload. */
export interface UploadFeedback {
  message: string;
  /** The bar's 0-1 fill; absent when there is nothing to measure. */
  progress?: number;
}

/** Where one photo falls among those a single save sends, 1-based. */
export interface UploadPosition {
  index: number;
  count: number;
}

/**
 * Turns the fraction of a photo sent so far into the overlay's two phases.
 *
 * Sending is measurable, so it gets a filling bar. But 100% sent is not
 * done: the API decodes the photo and writes its page-sized renditions
 * before it replies, which can take a few seconds for a big one. A bar
 * parked at 100% through that would read as a hang, so once everything is
 * sent the bar gives way to the turning ring and the message names the
 * work still going on — echoing the photo card's own promise that large
 * photos are resized.
 *
 * When one save sends several photos, `position` makes the sentence count
 * them ("photo 2 of 5"). "Nearly there" is kept for the last photo only:
 * on photo 1 of 5 it would promise more than the bar shows. A save that
 * sends a single photo reads exactly as if no position were given.
 *
 * The words are the admin's voice (docs/ui-design-brief.md §3), which is
 * why this lives here and not beside the upload in @kari/shared.
 */
export function uploadFeedback(
  fraction: number,
  position?: UploadPosition,
): UploadFeedback {
  const counted = position !== undefined && position.count > 1;
  const photo = counted
    ? `photo ${position.index} of ${position.count}`
    : "your photo";
  if (fraction < 1) {
    return { message: `Sending ${photo} to the site...`, progress: fraction };
  }
  const last = !counted || position.index === position.count;
  return {
    message: last
      ? `Nearly there — resizing ${photo} for the site...`
      : `Resizing ${photo} for the site...`,
    progress: undefined,
  };
}

/** An `onProgress` for ImageService.upload that narrates it on the overlay. */
export function reportUploadProgress(
  showLoading: (message: string, progress?: number) => void,
  position?: UploadPosition,
): UploadProgress {
  return (sent) => {
    const { message, progress } = uploadFeedback(sent, position);
    showLoading(message, progress);
  };
}
