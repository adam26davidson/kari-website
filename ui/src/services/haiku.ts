import { Haiku } from "../Models";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_HAIKU_URL = import.meta.env.VITE_API_URL + "/haiku";
const S3_HAIKU_URL = import.meta.env.VITE_S3_URL + "/haiku.json";

export class HaikuService {
  static async getListFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<Array<Haiku>> {
    const response = await authorizedFetch(
      API_HAIKU_URL,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch haiku list",
      "Failed to fetch haiku from API",
    );
    const data: Array<Haiku> = await response.json();
    return data;
  }

  static async getListFromS3(): Promise<Array<Haiku>> {
    const response = await fetch(S3_HAIKU_URL);
    // Throw instead of returning [] so an S3 outage is never mistaken
    // for a legitimately empty page.
    ensureOk(
      response,
      "Failed to fetch haiku list",
      "Failed to fetch haiku from S3",
    );
    const data: Array<Haiku> = await response.json();
    return data;
  }

  static async updateList(
    haikuList: Array<Haiku>,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      API_HAIKU_URL,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(haikuList),
      },
    );
    ensureOk(response, "Failed to update haiku list");
  }
}
