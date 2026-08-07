import { Haiku } from "../Models";
import { HttpError } from "./http-error";

const API_HAIKU_URL = import.meta.env.VITE_API_URL + "/haiku";
const S3_HAIKU_URL = import.meta.env.VITE_S3_URL + "/haiku.json";

export class HaikuService {
  static async getListFromApi(
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<Haiku>> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HAIKU_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error("Failed to fetch haiku from API", response.status);
      throw new HttpError(
        `Failed to fetch haiku list (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: Array<Haiku> = await response.json();
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiku>> {
    const response = await fetch(S3_HAIKU_URL);
    if (!response.ok) {
      // Throw instead of returning [] so an S3 outage is never mistaken
      // for a legitimately empty page.
      console.error("Failed to fetch haiku from S3", response.status);
      throw new HttpError(
        `Failed to fetch haiku list (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: Array<Haiku> = await response.json();
    console.log("Fetched Haiku List from S3:", data);
    return data;
  }

  static async updateList(
    haikuList: Array<Haiku>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HAIKU_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(haikuList),
    });
    if (!response.ok) {
      console.error("Failed to update haiku list", response.status);
      throw new Error(`Failed to update haiku list (HTTP ${response.status})`);
    }
  }
}
