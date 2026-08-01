import { PhotographyPost } from "../Models";

const API_URL = import.meta.env.VITE_API_URL + "/photography";
const S3_URL = import.meta.env.VITE_S3_URL + "/photography.json";

export class PhotographyService {
  static async getListFromApi(
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<PhotographyPost>> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error(
        "Failed to fetch photography post from API",
        response.status,
      );
      console.error("error", response);
      return [];
    }
    const data: Array<PhotographyPost> = await response.json();
    console.log("Fetched Photography Posts:", data);
    return data;
  }

  static async getListFromS3(): Promise<Array<PhotographyPost>> {
    const response = await fetch(S3_URL);
    if (!response.ok) {
      console.error("Failed to fetch photography posts", response.status);
      console.error("error", response);
      return [];
    }
    const data: Array<PhotographyPost> = await response.json();
    console.log("Fetched Photography Posts from S3:", data);
    return data;
  }

  static async updateList(
    postList: Array<PhotographyPost>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(postList),
    });
    if (!response.ok) {
      console.error("Failed to update Photography Post list", response.status);
      throw new Error(
        `Failed to update photography post list (HTTP ${response.status})`,
      );
    }
  }
}
