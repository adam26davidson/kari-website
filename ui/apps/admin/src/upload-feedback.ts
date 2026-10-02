/** What the loading overlay says, and shows, at one point of an upload. */
export interface UploadFeedback {
  message: string;
  /** The bar's 0-1 fill; absent when there is nothing to measure. */
  progress?: number;
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
 * The words are the admin's voice (docs/ui-design-brief.md §3), which is
 * why this lives here and not beside the upload in @kari/shared.
 */
export function uploadFeedback(fraction: number): UploadFeedback {
  if (fraction < 1) {
    return { message: "Sending your photo to the site...", progress: fraction };
  }
  return {
    message: "Nearly there — resizing your photo for the site...",
    progress: undefined,
  };
}
