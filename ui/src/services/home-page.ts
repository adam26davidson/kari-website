import { HomePageData } from "../models";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_HOME_PAGE_URL = import.meta.env.VITE_API_URL + "/home-page";
const S3_HOME_PAGE_URL = import.meta.env.VITE_S3_URL + "/home-page.json";

export class HomePageService {
  static async getFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<HomePageData> {
    const response = await authorizedFetch(
      API_HOME_PAGE_URL,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch home page data",
      "Failed to fetch home page data from API",
    );
    const data: HomePageData = await response.json();
    return data;
  }

  static async getFromS3(): Promise<HomePageData> {
    const response = await fetch(S3_HOME_PAGE_URL);
    // Throw instead of returning a default so an S3 outage is never
    // mistaken for a legitimately empty home page.
    ensureOk(
      response,
      "Failed to fetch home page data",
      "Failed to fetch home page data from S3",
    );
    const data: HomePageData = await response.json();
    return data;
  }

  static async update(
    homePageData: HomePageData,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      API_HOME_PAGE_URL,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(homePageData),
      },
    );
    ensureOk(response, "Failed to save home page data");
  }
}
