import { Haiga } from "../Models";

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
      console.error("error", response);
      return [];
    }
    const data: Array<Haiga> = await response.json();
    console.log("Fetched Haiga List:", data);
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiga>> {
    const response = await fetch(S3_HAIGA_URL);
    if (!response.ok) {
      console.error("Failed to fetch haiga", response.status);
      console.error("error", response);
      return [];
    }
    const data: Array<Haiga> = await response.json();
    console.log("Fetched Haiga List from S3:", data);
    return data;
  }

  static async updateList(
    haigaList: Array<Haiga>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<Haiga>> {
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
      console.error("error", response);
      return [];
    }
    const responseBody = await response.json();
    console.log("Saved Haiga List:", responseBody);
    return responseBody;
  }
}
