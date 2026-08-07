import { v4 as uuidv4 } from "uuid";
import { HttpError } from "./http-error";

const API_IMAGES_URL = import.meta.env.VITE_API_URL + "/images";

/** Response of `POST /images/gc` — keys are full S3 keys (`images/...`). */
export interface GcReport {
  dry_run: boolean;
  referenced: Array<string>;
  orphaned: Array<string>;
  skipped_recent: Array<string>;
  deleted: Array<string>;
}

export class ImageService {
  static async upload(
    file: File | null,
    isPublished: boolean,
    getAccessTokenSilently: () => Promise<string>,
  ) {
    if (!file) {
      console.error("No file provided for upload.");
      return null;
    }
    const token = await getAccessTokenSilently();

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

    // Set up the request to your file upload endpoint
    try {
      const response = await fetch(
        `${API_IMAGES_URL}?isPublished=${isPublished}`,
        {
          method: "POST",
          headers: {
            // Normally, Content-Type is automatically set to multipart/form-data by the browser when you use FormData
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Use the name the server stored the image under, falling back to
      // the sent name for older API versions that don't return one.
      const data = (await response.json().catch(() => null)) as {
        fileName?: string;
      } | null;
      return data?.fileName ?? fileName;
    } catch (error) {
      console.error("Failed to upload image", error);
      throw error;
    }
  }

  static async delete(
    fileName: string,
    getAccessTokenSilently: () => Promise<string>,
  ) {
    const token = await getAccessTokenSilently();
    const response = await fetch(`${API_IMAGES_URL}/${fileName}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error(`Failed to delete image: ${fileName}`);
      throw new Error(`Failed to delete image: ${fileName}`);
    }
  }

  static async setPublished(
    fileName: string,
    isPublished: boolean,
    getAccessTokenSilently: () => Promise<string>,
  ) {
    const token = await getAccessTokenSilently();
    const response = await fetch(
      `${API_IMAGES_URL}/${fileName}/set-published?isPublished=${isPublished}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to set image published status: ${fileName}. Error: ${errorText}`,
      );
      throw new Error(
        `Failed to set image published status: ${fileName}. Error: ${errorText}`,
      );
    }
  }

  /**
   * Runs the orphaned-image sweep. With `dryRun` true nothing is deleted —
   * the report only shows what a real run would do. The API aborts with a
   * 500 before deleting anything if any content manifest cannot be read.
   */
  static async gc(
    dryRun: boolean,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<GcReport> {
    const token = await getAccessTokenSilently();
    const response = await fetch(`${API_IMAGES_URL}/gc?dry_run=${dryRun}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      // Surface the server's reason (e.g. "aborted before any delete") —
      // a swallowed GC failure would look like a clean, empty report.
      const errorText = await response.text().catch(() => "");
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
