/**
 * Client-side validation for site-background uploads.
 *
 * The background is fetched by every visitor on every page, so a
 * camera-original (often 4000+ px and several MB) must never be what they
 * download — but the resizing happens in the API now (#453), which stores
 * the untouched original alongside a page-sized `background.jpg` rendition.
 * The browser used to downscale before uploading, which threw the original
 * away and pinned the stored background to whatever size that pass chose.
 *
 * What is left here is the part only the browser can do: tell her a file is
 * unusable BEFORE a save begins, in words she can act on.
 */

/** Raised for problems the admin can fix; `message` is shown verbatim. */
export class BackgroundImageError extends Error {}

/**
 * Hard ceiling, kept just BELOW what the server accepts so this friendly
 * message always arrives before a bare 413 can. The API's
 * `RequestBodyLimitLayer` (`api/src/routes/mod.rs`) sits at 25 MiB, and
 * 25 000 000 decimal bytes leaves ~1.2 MB of headroom under it for the
 * multipart framing (#706).
 *
 * The deployed nginx vhosts' `client_max_body_size` must be at least that
 * too, or nginx rejects the upload before it ever reaches the API. Those
 * vhosts are hand-maintained on the EC2 host rather than in this repo, so
 * their value is not verifiable from here; raising them is tracked as the
 * maintainer ask in #714. If you are debugging a 413 on an upload between
 * 10 and 25 MB, check nginx FIRST — it is the layer this repo cannot see.
 */
export const MAX_UPLOAD_BYTES = 25_000_000;

/**
 * Checks that `file` is an image the browser can decode and is small enough
 * for the API to accept. Resolves when it is usable; throws
 * BackgroundImageError with an admin-readable message when it is not.
 */
export async function validateBackgroundImage(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    throw new BackgroundImageError(
      "That file is not an image. Please choose an image file.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new BackgroundImageError(
      "That file could not be read as an image. It may be corrupted or an " +
        "unsupported format.",
    );
  }
  // Nothing else needs the pixels — the API derives every rendition — so
  // release them as soon as the decode has proved the file is readable.
  bitmap.close();

  if (file.size > MAX_UPLOAD_BYTES) {
    // The figure comes from the constant so the message cannot drift away
    // from the limit it is describing, as it did before #706.
    throw new BackgroundImageError(
      `This photo is too big to upload (over ${MAX_UPLOAD_BYTES / 1_000_000}` +
        " MB). Please pick a smaller one, or export a reduced-size copy " +
        "from your photo app and try again — the site resizes it for the " +
        "web from there.",
    );
  }
}
