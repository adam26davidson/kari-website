import { PhotographyPost } from "../Models";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_URL = import.meta.env.VITE_API_URL + "/photography";
const S3_URL = import.meta.env.VITE_S3_URL + "/photography.json";

export class PhotographyService {
  static async getListFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<Array<PhotographyPost>> {
    const response = await authorizedFetch(API_URL, getAccessTokenSilently);
    ensureOk(
      response,
      "Failed to fetch photography post list",
      "Failed to fetch photography post from API",
    );
    const data: Array<PhotographyPost> = await response.json();
    return data;
  }

  static async getListFromS3(): Promise<Array<PhotographyPost>> {
    const response = await fetch(S3_URL);
    // Throw instead of returning [] so an S3 outage is never mistaken
    // for a legitimately empty page.
    ensureOk(
      response,
      "Failed to fetch photography post list",
      "Failed to fetch photography posts from S3",
    );
    const data: Array<PhotographyPost> = await response.json();
    return data;
  }

  static async updateList(
    postList: Array<PhotographyPost>,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(API_URL, getAccessTokenSilently, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postList),
    });
    ensureOk(
      response,
      "Failed to update photography post list",
      "Failed to update Photography Post list",
    );
  }
}
