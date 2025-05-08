import { Haiku } from "../Models";

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
      console.error("error", response);
      return [];
    }
    const data: Array<Haiku> = await response.json();
    console.log("Fetched Haiku List:", data);
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiku>> {
    const response = await fetch(S3_HAIKU_URL);
    if (!response.ok) {
      console.error("Failed to fetch haiku from S3", response.status);
      console.error("error", response);
      return [];
    }
    const data: Array<Haiku> = await response.json();
    console.log("Fetched Haiku List from S3:", data);
    return data;
  }

  static async updateList(
    haikuList: Array<Haiku>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<Haiku>> {
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
      console.error("error", response);
      return [];
    }
    const responseBody = await response.json();
    console.log("Saved Haiku List:", responseBody);
    return responseBody;
  }
}
