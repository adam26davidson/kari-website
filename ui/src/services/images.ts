import { v4 as uuidv4 } from "uuid";
import { HttpError } from "./http-error";
import { TokenGetter, authorizedFetch, ensureOk, readErrorText } from "./http";

const API_IMAGES_URL = import.meta.env.VITE_API_URL + "/images";

/**
 * One image in a GC report: the image's file name and every object it
 * stores (an image is a directory of renditions, so usually the original
 * plus a thumbnail).
 */
export interface GcImage {
  id: string;
  /** Full S3 keys (`images/...`) of this image's stored objects. */
  keys: Array<string>;
}

/**
 * Response of `POST /images/gc`. Every category lists one entry per IMAGE,
 * so `orphaned.length` is a number of pictures — what the page tells Kari —
 * rather than a number of storage objects.
 */
export interface GcReport {
  dry_run: boolean;
  referenced: Array<GcImage>;
  orphaned: Array<GcImage>;
  skipped_recent: Array<GcImage>;
  deleted: Array<GcImage>;
}

export class ImageService {
  static async upload(
    file: File | null,
    isPublished: boolean,
    getAccessTokenSilently: TokenGetter,
  ) {
    if (!file) {
      console.error("No file provided for upload.");
      return null;
    }

    // The API generates the stored name (uuid + extension) and returns it;
    // that returned name is authoritative. The client-side uuid rename is
    // kept only as a deploy-skew fallback: an older API stores the sent
    // name verbatim and returns no fileName, so the name sent must already
    // be unique.
    const extension = file.name.includes(".")
      ? `.${file.name.split(".").pop()}`
      : "";
    const fileName = `${uuidv4()}${extension}`;

    // Rename the file to the unique name
    file = new File([file], fileName, { type: file.type });

    // Create a FormData object and append the file
    const formData = new FormData();
    formData.append("file", file); // Ensure that your server is expecting the file under the key "file"

    // Set up the request to your file upload endpoint. Content-Type is set
    // to multipart/form-data automatically by the browser when the body is
    // FormData, so only the bearer header is added.
    const response = await authorizedFetch(
      `${API_IMAGES_URL}?isPublished=${isPublished}`,
      getAccessTokenSilently,
      { method: "POST", body: formData },
    );
    ensureOk(response, "Failed to upload image");

    // Use the name the server stored the image under, falling back to
    // the sent name for older API versions that don't return one.
    const data = (await response.json().catch(() => null)) as {
      fileName?: string;
    } | null;
    return data?.fileName ?? fileName;
  }

  /**
   * File names of every uploaded image, newest first — the "pick an
   * already-uploaded image" source. Admin-only: the listing includes
   * unpublished images.
   */
  static async list(
    getAccessTokenSilently: TokenGetter,
  ): Promise<Array<string>> {
    const response = await authorizedFetch(
      API_IMAGES_URL,
      getAccessTokenSilently,
    );
    ensureOk(response, "Failed to list images");
    const data: { images: Array<string> } = await response.json();
    return data.images;
  }

  static async setPublished(
    fileName: string,
    isPublished: boolean,
    getAccessTokenSilently: TokenGetter,
  ) {
    const response = await authorizedFetch(
      `${API_IMAGES_URL}/${fileName}/set-published?isPublished=${isPublished}`,
      getAccessTokenSilently,
      { method: "PUT" },
    );
    if (!response.ok) {
      const errorText = await readErrorText(response);
      const message = `Failed to set image published status: ${fileName}. Error: ${errorText}`;
      console.error(message);
      throw new HttpError(message, response.status);
    }
  }

  /**
   * Runs the orphaned-image sweep. With `dryRun` true nothing is deleted —
   * the report only shows what a real run would do. The API aborts with a
   * 500 before deleting anything if any content manifest cannot be read.
   */
  static async gc(
    dryRun: boolean,
    getAccessTokenSilently: TokenGetter,
  ): Promise<GcReport> {
    const response = await authorizedFetch(
      `${API_IMAGES_URL}/gc?dry_run=${dryRun}`,
      getAccessTokenSilently,
      { method: "POST" },
    );
    if (!response.ok) {
      // Surface the server's reason (e.g. "aborted before any delete") —
      // a swallowed GC failure would look like a clean, empty report.
      const errorText = await readErrorText(response);
      console.error("Image GC request failed", response.status, errorText);
      throw new HttpError(
        `Image cleanup failed (HTTP ${response.status})` +
          (errorText ? `: ${errorText}` : ""),
        response.status,
      );
    }
    const report: GcReport = await response.json();
    return report;
  }
}
