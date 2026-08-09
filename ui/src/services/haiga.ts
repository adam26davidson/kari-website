import { Haiga } from "../Models";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_HAIGA_URL = import.meta.env.VITE_API_URL + "/haiga";
const S3_HAIGA_URL = import.meta.env.VITE_S3_URL + "/haiga.json";

export class HaigaService {
  static async getListFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<Array<Haiga>> {
    const response = await authorizedFetch(
      API_HAIGA_URL,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch haiga list",
      "Failed to fetch haiga from API",
    );
    const data: Array<Haiga> = await response.json();
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiga>> {
    const response = await fetch(S3_HAIGA_URL);
    // Throw instead of returning [] so an S3 outage is never mistaken
    // for a legitimately empty page.
    ensureOk(
      response,
      "Failed to fetch haiga list",
      "Failed to fetch haiga from S3",
    );
    const data: Array<Haiga> = await response.json();
    return data;
  }

  static async updateList(
    haigaList: Array<Haiga>,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      API_HAIGA_URL,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(haigaList),
      },
    );
    ensureOk(response, "Failed to update haiga list");
  }
}
