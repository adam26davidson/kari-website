import { v4 as uuidv4 } from "uuid";

const API_IMAGES_URL = import.meta.env.VITE_API_URL + "/images";

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

      return fileName;
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
}
