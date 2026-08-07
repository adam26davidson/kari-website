import { HomePageData } from "../Models";
import { HttpError } from "./http-error";

const API_HOME_PAGE_URL = import.meta.env.VITE_API_URL + "/home-page";
const S3_HOME_PAGE_URL = import.meta.env.VITE_S3_URL + "/home-page.json";

export class HomePageService {
  static async getFromApi(
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<HomePageData> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HOME_PAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error(
        "Failed to fetch home page data from API",
        response.status,
      );
      throw new HttpError(
        `Failed to fetch home page data (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: HomePageData = await response.json();
    return data;
  }

  static async getFromS3(): Promise<HomePageData> {
    const response = await fetch(S3_HOME_PAGE_URL);
    if (!response.ok) {
      // Throw instead of returning a default so an S3 outage is never
      // mistaken for a legitimately empty home page.
      console.error("Failed to fetch home page data from S3", response.status);
      throw new HttpError(
        `Failed to fetch home page data (HTTP ${response.status})`,
        response.status,
      );
    }
    const data: HomePageData = await response.json();
    return data;
  }

  static async update(
    homePageData: HomePageData,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_HOME_PAGE_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(homePageData),
    });
    if (!response.ok) {
      console.error("Failed to save home page data", response.status);
      throw new HttpError(
        `Failed to save home page data (HTTP ${response.status})`,
        response.status,
      );
    }
  }
}
