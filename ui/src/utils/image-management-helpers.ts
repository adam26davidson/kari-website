const API_URL = import.meta.env.VITE_API_URL;
const S3_URL = import.meta.env.VITE_S3_URL;

/** Longest extension the API preserves on a stored key. */
const MAX_EXTENSION_LEN = 16;

/**
 * A derived size of an image. The API stores one object per variant under
 * the image's prefix; the set is closed on both sides, so a typo is a
 * compile error here and a 400 there.
 */
export type ImageVariant = "thumb";

/**
 * The extension the API gave an image's stored objects, derived from its id
 * exactly as the API's `sanitized_extension` does: the last `.`-suffix of a
 * non-empty stem, lowercased, alphanumeric and short — otherwise none.
 * Duplicated rather than shared because the two live in different languages;
 * the API's `image_keys` tests pin the same rules.
 */
const imageExtension = (id: string) => {
  const dot = id.lastIndexOf(".");
  const stem = id.slice(0, dot);
  const extension = id.slice(dot + 1);
  const usable =
    dot > 0 &&
    stem !== "" &&
    extension !== "" &&
    extension.length <= MAX_EXTENSION_LEN &&
    /^[a-zA-Z0-9]+$/.test(extension);
  return usable ? `.${extension.toLowerCase()}` : "";
};

/**
 * Public URL of an image's untouched original. The site reads straight from
 * S3, where query parameters cannot select an object, so the variant is part
 * of the path.
 */
export const s3ImageUrl = (id: string) =>
  `${S3_URL}/images/${id}/original${imageExtension(id)}`;

/**
 * API URL of an image. Without a variant this serves the original; with one
 * it serves that rendition, falling back to the original when it does not
 * exist — so `"thumb"` is always safe to ask for.
 */
export const apiImageUrl = (id: string, variant?: ImageVariant) =>
  `${API_URL}/images/${id}${variant ? `?size=${variant}` : ""}`;

/**
 * The image id inside a URL — the segment right after `/images/`, which is
 * what every stored reference (manifests, site settings, this app's state)
 * holds. Falls back to the last path segment for a URL with no `/images/`
 * marker at all.
 */
export const getImageFileName = (url: string): string => {
  const path = url.split(/[?#]/)[0];
  const segments = path.split("/");
  const marker = segments.indexOf("images");
  // Splitting always yields at least one segment, so both branches return a
  // string — "" for a url that ends at the marker.
  return marker === -1
    ? segments[segments.length - 1]
    : (segments[marker + 1] ?? "");
};

export const changeImageUrlToS3 = (url: string) =>
  s3ImageUrl(getImageFileName(url));

export const changeImageUrlToApi = (url: string) =>
  apiImageUrl(getImageFileName(url));
