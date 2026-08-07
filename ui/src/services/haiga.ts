import { Haiga } from "../Models";
import { HttpError } from "./http-error";

const API_HAIGA_URL = import.meta.env.VITE_API_URL + "/haiga";
const S3_HAIGA_URL = import.meta.env.VITE_S3_URL + "/haiga.json";

export class HaigaService {
  static async getListFromApi(
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<Haiga>> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HAIGA_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error("Failed to fetch haiga from API", response.status);
      throw new HttpError(
        `Failed to fetch haiga list (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: Array<Haiga> = await response.json();
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiga>> {
    const response = await fetch(S3_HAIGA_URL);
    if (!response.ok) {
      // Throw instead of returning [] so an S3 outage is never mistaken
      // for a legitimately empty page.
      console.error("Failed to fetch haiga from S3", response.status);
      throw new HttpError(
        `Failed to fetch haiga list (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: Array<Haiga> = await response.json();
    return data;
  }

  static async updateList(
    haigaList: Array<Haiga>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HAIGA_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(haigaList),
    });
    if (!response.ok) {
      console.error("Failed to update haiga list", response.status);
      throw new HttpError(
        `Failed to update haiga list (HTTP ${response.status})`,
        response.status,
      );
    }
  }
}
