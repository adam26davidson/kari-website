/**
 * The admin's two save-failure toasts (#830). Each says what happened and
 * what to do next (design brief, principle 5), and each has to be TRUE on
 * every path that raises it — so there are two, not one.
 */

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
