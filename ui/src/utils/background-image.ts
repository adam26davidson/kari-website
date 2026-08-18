/**
 * Client-side validation and downscaling for site-background uploads.
 *
 * The background is fetched by every visitor on every page, so a
 * camera-original (often 4000+ px and several MB) should never be stored
 * as-is. Oversized images are downscaled to at most MAX_DIMENSION on the
 * long edge and re-encoded (WebP where the browser supports it), which
 * typically turns a multi-MB photo into a few hundred kB with no visible
 * loss at background sizes.
 */

/** Raised for problems the admin can fix; `message` is shown verbatim. */
export class BackgroundImageError extends Error {}

/** Longest edge kept on an uploaded background, in px. */
export const MAX_DIMENSION = 2560;

/** Originals within MAX_DIMENSION and this size pass through untouched. */
const PASSTHROUGH_MAX_BYTES = 1_500_000;

/** Hard ceiling; the API rejects request bodies over 10 MB. */
const MAX_UPLOAD_BYTES = 9_000_000;

/** Encoding quality for the downscaled background. */
const ENCODE_QUALITY = 0.82;

function withExtensionFor(name: string, mimeType: string): string {
  const extension = mimeType.split("/").pop() ?? "img";
  const stem = name.includes(".")
    ? name.slice(0, name.lastIndexOf("."))
    : name;
  return `${stem}.${extension}`;
}

/** The original, when it fits the upload limit; an error otherwise. */
function passthrough(file: File): File {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BackgroundImageError(
      "This image is too large to upload (over 9 MB) and could not be " +
        "resized by your browser. Please resize it and try again.",
    );
  }
  return file;
}

/**
 * Validates `file` as an image and returns a version suitable to store as
 * the site background: the file itself when it is already small, or a
 * downscaled re-encode. Throws BackgroundImageError with an
 * admin-readable message when the file is not a usable image.
 */
export async function prepareBackgroundImage(file: File): Promise<File> {
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

  try {
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    if (scale === 1 && file.size <= PASSTHROUGH_MAX_BYTES) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      return passthrough(file);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", ENCODE_QUALITY);
    });
    if (!blob) {
      return passthrough(file);
    }

    // Keep the re-encode when it shrank the pixels; for a same-size
    // re-encode (already within MAX_DIMENSION, just a heavy file) only
    // when it actually saved bytes — a browser without WebP support can
    // hand back a PNG larger than the original.
    const resized =
      scale < 1 || blob.size < file.size
        ? new File([blob], withExtensionFor(file.name, blob.type), {
            type: blob.type,
          })
        : file;
    return passthrough(resized);
  } finally {
    bitmap.close();
  }
}
