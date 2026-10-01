/**
 * The one client-side size check every admin image picker shares (#711).
 *
 * All of them — the photo picker on the haiga, photography, home page and
 * appearance editors, and the blog editor's "Add an image" — upload through
 * `ImageService.upload` to the same `POST /images` route, so they share one
 * server ceiling and one friendly message. Checking at pick time means an
 * oversized photo is turned away in plain words before anything uploads,
 * rather than failing after a long upload as a generic "Failed to save".
 */

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
 * their value is not verifiable from here (#714). If you are debugging a
 * 413 on an upload between 10 and 25 MB, check nginx FIRST — it is the
 * layer this repo cannot see.
 */
export const MAX_UPLOAD_BYTES = 25_000_000;

/**
 * Returns an admin-readable reason `file` cannot be uploaded because of its
 * size, or null when its size is fine.
 */
export function uploadSizeProblem(file: File): string | null {
  if (file.size <= MAX_UPLOAD_BYTES) {
    return null;
  }
  // The figure comes from the constant so the message cannot drift away
  // from the limit it is describing, as it did before #706.
  return (
    `This photo is too big to upload (over ${MAX_UPLOAD_BYTES / 1_000_000}` +
    " MB). Please pick a smaller one, or export a reduced-size copy " +
    "from your photo app and try again — the site resizes it for the " +
    "web from there."
  );
}
