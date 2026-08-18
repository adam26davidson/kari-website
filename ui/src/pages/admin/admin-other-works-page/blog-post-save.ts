import { BlogPost } from "../../../models";
import { TokenGetter } from "../../../services/http";
import {
  changeImageUrlToApi,
  changeImageUrlToS3,
  getImageFileName,
} from "../../../utils/image-management-helpers";

const S3_URL = import.meta.env.VITE_S3_URL;
const API_URL = import.meta.env.VITE_API_URL;

// Shown when a failed publish/unpublish could not fully restore the
// previous state; storage stays mixed until the same save is retried.
export const ROLLBACK_INCOMPLETE_MESSAGE =
  "Save failed and rolling back was incomplete — some content or images " +
  "may have the wrong visibility. Save again to retry.";

/**
 * Everything the save needs from the outside world, passed in so this
 * module stays React-free and unit-testable: the blog/image services, the
 * page's list persistence, and the admin chrome's notifiers.
 */
export interface BlogPostSaveDeps {
  getToken: TokenGetter;
  /** `BlogService.updateContent`. */
  updateContent: (
    id: string,
    content: string,
    isPublished: boolean,
    getToken: TokenGetter,
  ) => Promise<void>;
  /** `ImageService.upload`; resolves the stored file name. */
  uploadImage: (
    file: File,
    isPublished: boolean,
    getToken: TokenGetter,
  ) => Promise<string | null>;
  /** `ImageService.setPublished`. */
  setImagePublished: (
    fileName: string,
    isPublished: boolean,
    getToken: TokenGetter,
  ) => Promise<void>;
  /**
   * `useAdminList`'s saveList: persists newList and adopts it as the local
   * list, toasting its own error and resolving false on failure.
   */
  saveList: (newList: Array<BlogPost>) => Promise<boolean>;
  /**
   * Restores the pre-save list through the API and in local state; throws
   * when the API call fails.
   */
  restoreList: () => Promise<void>;
  showLoading: (message: string) => void;
  notify: (message: string, type?: "success" | "error") => void;
}

/** Whether the save flips the post's published state, and which way. */
export type PublishFlip = "publishing" | "unpublishing" | "none";

/**
 * The image work a content save implies, computed by diffing the original
 * content against the new. `doc` holds the parsed new content with kept
 * images' srcs already rewritten to the destination host when flipping;
 * serialize it only after the pending uploads have patched in their real
 * urls.
 */
export interface ContentSavePlan {
  /**
   * Images present in both contents, srcs rewritten in `doc` when
   * flipping. In-memory only — the actual visibility flips happen during
   * the transaction, at the safe point for each direction.
   */
  keptImageFileNames: Array<string>;
  /**
   * Imgs in the new content with no same-src original counterpart, in
   * content order — the upload candidates. When flipping, kept images
   * appear here too (their srcs were just rewritten away from the
   * originals'), but they carry no pending file so the upload pass skips
   * them, exactly as the pre-refactor per-img scan did.
   */
  addedImages: Array<HTMLImageElement>;
  /** The parsed new content; owns the elements in `addedImages`. */
  doc: Document;
}

/**
 * The two DOM-diffing passes of a save, pure and side-effect free:
 * kept images (in original and new; srcs rewritten when the save
 * publishes or unpublishes) and added images (in new, not in original).
 * Images dropped from the content are simply no longer referenced —
 * their objects are left for the image-cleanup sweep, since they may
 * still be referenced by other content (e.g. as the site background).
 *
 * when a post is published, image URLs use the S3 URL
 * when a post is not published, image URLs use the API URL
 *
 * Same-src duplicates are matched pairwise in content order via a
 * src-keyed index built once, instead of re-scanning all imgs per img
 * (the old `Array.from(...).find(...)` was O(n²)).
 */
export function planContentSave(
  originalHtml: string,
  newHtml: string,
  flip: PublishFlip,
): ContentSavePlan {
  const newHtmlDoc = new DOMParser().parseFromString(newHtml, "text/html");
  const originalHtmlDoc = new DOMParser().parseFromString(
    originalHtml,
    "text/html",
  );

  // find all images
  const newImages = Array.from(newHtmlDoc.querySelectorAll("img"));
  const originalImages = Array.from(originalHtmlDoc.querySelectorAll("img"));

  // Index the new imgs by src once. The per-src lists are consumed
  // (shifted) by the kept-image pass below so same-src duplicates pair up
  // one-to-one in content order.
  const newImagesBySrc = new Map<string, Array<HTMLImageElement>>();
  for (const newImage of newImages) {
    const sameSrc = newImagesBySrc.get(newImage.src);
    if (sameSrc) {
      sameSrc.push(newImage);
    } else {
      newImagesBySrc.set(newImage.src, [newImage]);
    }
  }
  // The original imgs are never mutated, so a plain src set suffices for
  // the added-image pass.
  const originalImageSrcs = new Set(originalImages.map((img) => img.src));

  // Rewrite the kept images' srcs to the destination host and collect
  // their file names.
  const keptImageFileNames: Array<string> = [];
  if (flip !== "none") {
    const urlConverter =
      flip === "publishing" ? changeImageUrlToS3 : changeImageUrlToApi;
    for (const originalImage of originalImages) {
      const newImage = newImagesBySrc.get(originalImage.src)?.shift();
      if (!newImage) continue;
      const fileName = getImageFileName(originalImage.src);
      newImage.src = urlConverter(originalImage.src);
      if (fileName) {
        keptImageFileNames.push(fileName);
      } else {
        console.error(`File name not found for image: ${originalImage.src}`);
      }
    }
  }

  const addedImages = newImages.filter(
    (newImage) => !originalImageSrcs.has(newImage.src),
  );

  return {
    keptImageFileNames,
    addedImages,
    doc: newHtmlDoc,
  };
}

/**
 * Uploads the pending file behind each added img and patches the img's
 * src to the stored url. This happens before anything existing is
 * touched: a failed upload (thrown here) aborts the save with the
 * previous state fully intact (at worst it leaves orphaned uploads for
 * the GC sweep).
 */
async function uploadAddedImages(
  addedImages: Array<HTMLImageElement>,
  pendingImageFiles: Map<string, File>,
  isPublished: boolean,
  deps: BlogPostSaveDeps,
): Promise<void> {
  const baseUrl = `${isPublished ? S3_URL : API_URL}/images/`;
  for (const newImage of addedImages) {
    // The img's title carries the stable id its pending file is keyed
    // by, so the file stays attached however the image has been moved
    // around inside the content (#134). The map is not touched here — on
    // a later failure the whole save retries with every pending file
    // still present (a re-upload just leaves an orphan for the GC
    // sweep).
    const pendingFile = pendingImageFiles.get(newImage.title);
    if (!pendingFile) continue;
    const fileName = await deps.uploadImage(
      pendingFile,
      isPublished,
      deps.getToken,
    );
    if (!fileName) {
      throw new Error("Failed to upload image");
    }
    newImage.src = baseUrl + fileName;
  }
}

/** How a save transaction ended. */
export type SaveOutcome =
  /** Everything persisted; the editor can close. */
  | "saved"
  /** An operation threw; the caller of the strategy reports the error. */
  | "failed"
  /**
   * `saveList` resolved false (it already toasted its own error) and any
   * needed rollback ran.
   */
  | "rolledBack";

export interface SaveBlogPostResult {
  outcome: SaveOutcome;
  /**
   * True when a failed save could not fully restore the previous state —
   * some content or images may have the wrong visibility until the same
   * save is retried. Part of the returned result (not a side channel) so
   * the error toast can report it.
   */
  rollbackIncomplete: boolean;
}

/** A strategy's result; `error` is the failure behind a "failed" outcome. */
interface TransactionResult extends SaveBlogPostResult {
  error?: unknown;
}

/** Everything shared by the three transaction strategies. */
interface SaveTransaction {
  postId: string;
  /** The serialized new content, uploads already patched in. */
  newHtmlString: string;
  /** The pre-save content, for rollback restores. */
  originalHtml: string;
  keptImageFileNames: Array<string>;
  newPostList: Array<BlogPost>;
  /** The post's target published state. */
  isPublished: boolean;
  deps: BlogPostSaveDeps;
}

/**
 * Best-effort flip-back used only on rollback paths. Image visibility is
 * a reversible tag on the same S3 object (no data is moved), so
 * re-flipping restores the previous state exactly; a failure here leaves
 * images half-flipped and is reported loudly, never swallowed — the
 * returned false marks the rollback incomplete.
 */
async function rollBackImageFlips(
  fileNames: Array<string>,
  isPublished: boolean,
  deps: BlogPostSaveDeps,
): Promise<boolean> {
  let complete = true;
  for (const fileName of fileNames) {
    try {
      await deps.setImagePublished(fileName, isPublished, deps.getToken);
    } catch (error) {
      console.error(error);
      complete = false;
    }
  }
  return complete;
}

type FlipImagesResult =
  | { ok: true }
  | { ok: false; error: unknown; rollbackIncomplete: boolean };

/**
 * Flip each image's visibility one at a time, flipping the already-
 * flipped ones back on a mid-loop failure so no half-migrated image set
 * survives; returns the original failure (and whether the flip-back
 * itself fell short) instead of completing.
 */
async function setImagesPublishedOrRollBack(
  fileNames: Array<string>,
  isPublished: boolean,
  deps: BlogPostSaveDeps,
): Promise<FlipImagesResult> {
  const flipped: Array<string> = [];
  try {
    for (const fileName of fileNames) {
      await deps.setImagePublished(fileName, isPublished, deps.getToken);
      flipped.push(fileName);
    }
  } catch (error) {
    const complete = await rollBackImageFlips(flipped, !isPublished, deps);
    return { ok: false, error, rollbackIncomplete: !complete };
  }
  return { ok: true };
}

/**
 * Restores the pre-save content and/or list after a failed step. The
 * restores share one try — a content-restore failure skips the list
 * restore, exactly as the pre-refactor inline blocks did. Returns false
 * when the restoration did not fully run (rollback incomplete).
 */
async function restorePreviousState(
  restore: {
    content?: { html: string; isPublished: boolean };
    list?: boolean;
  },
  tx: SaveTransaction,
): Promise<boolean> {
  try {
    if (restore.content) {
      await tx.deps.updateContent(
        tx.postId,
        restore.content.html,
        restore.content.isPublished,
        tx.deps.getToken,
      );
    }
    if (restore.list) {
      await tx.deps.restoreList();
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/** The publishing transaction: images public -> content -> list. */
async function runPublishingSave(
  tx: SaveTransaction,
): Promise<TransactionResult> {
  const { deps } = tx;

  // Public images first: this is safe while the post is still a draft,
  // because the editor loads images through the API, which serves them
  // regardless of their public tag.
  deps.showLoading("Updating image visibility...");
  const flip = await setImagesPublishedOrRollBack(
    tx.keptImageFileNames,
    true,
    deps,
  );
  if (!flip.ok) {
    return {
      outcome: "failed",
      rollbackIncomplete: flip.rollbackIncomplete,
      error: flip.error,
    };
  }

  deps.showLoading("Saving other works item content...");
  try {
    await deps.updateContent(tx.postId, tx.newHtmlString, true, deps.getToken);
  } catch (error) {
    // The draft content object is untouched (this PUT failed), so
    // flipping the images back restores the previous state exactly.
    const flipsRestored = await rollBackImageFlips(
      tx.keptImageFileNames,
      false,
      deps,
    );
    return { outcome: "failed", rollbackIncomplete: !flipsRestored, error };
  }

  // Commit point: only now may the list mark the post published.
  if (!(await deps.saveList(tx.newPostList))) {
    // The public list still says draft; restore the draft content and
    // image visibility so the previous state stays intact. (saveList
    // already showed its own error toast.)
    deps.showLoading("Rolling back...");
    const contentRestored = await restorePreviousState(
      { content: { html: tx.originalHtml, isPublished: false } },
      tx,
    );
    const flipsRestored = await rollBackImageFlips(
      tx.keptImageFileNames,
      false,
      deps,
    );
    return {
      outcome: "rolledBack",
      rollbackIncomplete: !contentRestored || !flipsRestored,
    };
  }

  return { outcome: "saved", rollbackIncomplete: false };
}

/** The unpublishing transaction: list (hides the post) -> content -> images. */
async function runUnpublishingSave(
  tx: SaveTransaction,
): Promise<TransactionResult> {
  const { deps } = tx;

  // Hiding the post comes first; a failure aborts with everything else
  // untouched (#112).
  if (!(await deps.saveList(tx.newPostList))) {
    return { outcome: "rolledBack", rollbackIncomplete: false };
  }

  deps.showLoading("Saving other works item content...");
  try {
    await deps.updateContent(tx.postId, tx.newHtmlString, false, deps.getToken);
  } catch (error) {
    // The list already says draft, but the published content object is
    // untouched (this PUT failed); restoring the list restores the
    // previous published state exactly.
    const listRestored = await restorePreviousState({ list: true }, tx);
    return { outcome: "failed", rollbackIncomplete: !listRestored, error };
  }

  // The post is hidden and its content now uses API URLs, so nothing
  // public references these images any more — make them private. On a
  // mid-loop failure the whole unpublish rolls back: the helper
  // re-publishes the flipped images, then the published content and list
  // are restored.
  deps.showLoading("Updating image visibility...");
  const flip = await setImagesPublishedOrRollBack(
    tx.keptImageFileNames,
    false,
    deps,
  );
  if (!flip.ok) {
    deps.showLoading("Rolling back...");
    const restored = await restorePreviousState(
      { content: { html: tx.originalHtml, isPublished: true }, list: true },
      tx,
    );
    return {
      outcome: "failed",
      rollbackIncomplete: flip.rollbackIncomplete || !restored,
      error: flip.error,
    };
  }

  return { outcome: "saved", rollbackIncomplete: false };
}

/** The no-flip transaction: content -> list, no image visibility work. */
async function runNoFlipSave(tx: SaveTransaction): Promise<TransactionResult> {
  const { deps } = tx;

  deps.showLoading("Saving other works item content...");
  try {
    await deps.updateContent(
      tx.postId,
      tx.newHtmlString,
      tx.isPublished,
      deps.getToken,
    );
  } catch (error) {
    return { outcome: "failed", rollbackIncomplete: false, error };
  }

  if (!(await deps.saveList(tx.newPostList))) {
    // No-flip: the content is already saved, so a failed list save
    // leaves the old title/date over the new content — the reverse (new
    // metadata over old content) would misrepresent what the post
    // contains. Saving again retries both. (saveList already showed its
    // own error toast.)
    return { outcome: "rolledBack", rollbackIncomplete: false };
  }

  return { outcome: "saved", rollbackIncomplete: false };
}

export interface SaveBlogPostArgs {
  /** The edited post, carrying its target published state. */
  post: BlogPost;
  /** The saved post's published state before the edit. */
  wasPublished: boolean;
  /** The post list with the edited post already swapped in. */
  newPostList: Array<BlogPost>;
  /** The content as loaded when the editor opened. */
  originalContent: string | null;
  /** The content as it stands in the editor. */
  newContent: string | null;
  /** Freshly picked files awaiting upload, keyed by img-title id (#134). */
  pendingImageFiles: Map<string, File>;
  deps: BlogPostSaveDeps;
}

/**
 * The whole save: plan the image diff, upload pending files, then run
 * the publish/unpublish/no-flip transaction. Images removed from the
 * content are left in storage for the image-cleanup sweep — they may
 * still be referenced by other content (e.g. as the site background).
 * Owns every toast except saveList's own; never throws. The caller
 * closes the editor only on a "saved" outcome.
 */
export async function saveBlogPost(
  args: SaveBlogPostArgs,
): Promise<SaveBlogPostResult> {
  const { post, deps } = args;
  const publishing = !args.wasPublished && post.isPublished;
  const unpublishing = args.wasPublished && !post.isPublished;
  const flip: PublishFlip = publishing
    ? "publishing"
    : unpublishing
      ? "unpublishing"
      : "none";
  const originalHtml = args.originalContent || "";

  let result: TransactionResult;
  try {
    const plan = planContentSave(originalHtml, args.newContent || "", flip);

    // Upload images in new that are not in original, before anything
    // existing is touched.
    deps.showLoading("Uploading images...");
    await uploadAddedImages(
      plan.addedImages,
      args.pendingImageFiles,
      post.isPublished,
      deps,
    );

    // convert the new HTML back to a string; serialize only the body
    // fragment so saved content isn't wrapped in
    // <html><head></head><body>…</body></html> (#80)
    const newHtmlString = plan.doc.body.innerHTML;

    // Publishing is committed by the list save, which therefore goes
    // LAST — the public list must never claim a post whose public
    // content and images don't exist yet. Unpublishing flips the list
    // FIRST, hiding the post before any public object changes, and a
    // failure aborts with everything else untouched (#112). A no-flip
    // save orders content before list too, so a content failure can't
    // leave new metadata (title/date) over old content (#135).
    const tx: SaveTransaction = {
      postId: post.id,
      newHtmlString,
      originalHtml,
      keptImageFileNames: plan.keptImageFileNames,
      newPostList: args.newPostList,
      isPublished: post.isPublished,
      deps,
    };
    result = publishing
      ? await runPublishingSave(tx)
      : unpublishing
        ? await runUnpublishingSave(tx)
        : await runNoFlipSave(tx);
  } catch (error) {
    // Planning/upload failures abort before the transaction starts, with
    // the previous state fully intact.
    console.error(error);
    deps.notify("Failed to save other works item", "error");
    return { outcome: "failed", rollbackIncomplete: false };
  }

  if (result.outcome === "failed") {
    console.error(result.error);
    deps.notify(
      result.rollbackIncomplete
        ? ROLLBACK_INCOMPLETE_MESSAGE
        : "Failed to save other works item",
      "error",
    );
    return { outcome: "failed", rollbackIncomplete: result.rollbackIncomplete };
  }
  if (result.outcome === "rolledBack") {
    // saveList already toasted the underlying list-save failure; only an
    // incomplete rollback needs its own, louder report.
    if (result.rollbackIncomplete) {
      deps.notify(ROLLBACK_INCOMPLETE_MESSAGE, "error");
    }
    return {
      outcome: "rolledBack",
      rollbackIncomplete: result.rollbackIncomplete,
    };
  }

  deps.notify("Other works item saved");
  return { outcome: "saved", rollbackIncomplete: false };
}
