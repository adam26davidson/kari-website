import { describe, it, expect } from "vitest";
import { SiteSettingsService } from "./site-settings";
import { SiteSettings } from "../models";
import { HttpError } from "./http-error";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

const API_SITE_SETTINGS_URL = "https://api.test.local/site-settings";
const S3_SITE_SETTINGS_URL = "https://s3.test.local/site-settings.json";

const sampleSettings: SiteSettings = { backgroundPhoto: "bg.webp" };

setupServiceTestHooks();

describe("SiteSettingsService.getFromApi", () => {
  it("sends a bearer token and returns the parsed settings", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => sampleSettings,
    });

    const result = await SiteSettingsService.getFromApi(getToken);

    expect(result).toEqual(sampleSettings);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(API_SITE_SETTINGS_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws on an error response so the editor can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(SiteSettingsService.getFromApi(getToken)).rejects.toThrow(
      "Failed to fetch site settings (HTTP 500)",
    );
  });
});

describe("SiteSettingsService.getFromS3", () => {
  it("fetches the public json without a token", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => sampleSettings,
    });
    const result = await SiteSettingsService.getFromS3();
    expect(result).toEqual(sampleSettings);
    expect(fetchMock).toHaveBeenCalledWith(S3_SITE_SETTINGS_URL);
  });

  it("throws an HttpError on a non-ok response so callers can fall back", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    const error = await SiteSettingsService.getFromS3().catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Failed to fetch site settings (HTTP 404)");
  });
});

describe("SiteSettingsService.update", () => {
  it("PUTs the settings with the bearer token", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await SiteSettingsService.update(sampleSettings, getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_SITE_SETTINGS_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify(sampleSettings),
    });
  });

  it("throws when the save fails", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      SiteSettingsService.update(sampleSettings, getToken),
    ).rejects.toThrow("Failed to save site settings (HTTP 500)");
  });
});
