import { SiteSettings } from "../models";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_SITE_SETTINGS_URL = import.meta.env.VITE_API_URL + "/site-settings";
const S3_SITE_SETTINGS_URL =
  import.meta.env.VITE_S3_URL + "/site-settings.json";

export class SiteSettingsService {
  static async getFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<SiteSettings> {
    const response = await authorizedFetch(
      API_SITE_SETTINGS_URL,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch site settings",
      "Failed to fetch site settings from API",
    );
    const data: SiteSettings = await response.json();
    return data;
  }

  /**
   * The public read path. Unlike the API route this throws on a missing
   * object too (S3 serves a plain 403/404, not blank defaults) — callers
   * treat any failure as "use the default background".
   */
  static async getFromS3(): Promise<SiteSettings> {
    const response = await fetch(S3_SITE_SETTINGS_URL);
    ensureOk(
      response,
      "Failed to fetch site settings",
      "Failed to fetch site settings from S3",
    );
    const data: SiteSettings = await response.json();
    return data;
  }

  static async update(
    settings: SiteSettings,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      API_SITE_SETTINGS_URL,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
    );
    ensureOk(response, "Failed to save site settings");
  }
}
