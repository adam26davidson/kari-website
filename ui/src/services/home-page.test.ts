import { describe, it, expect } from "vitest";
import { HomePageService } from "./home-page";
import { HomePageData } from "../models";
import { HttpError } from "./http-error";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

const API_HOME_PAGE_URL = "https://api.test.local/home-page";
const S3_HOME_PAGE_URL = "https://s3.test.local/home-page.json";

const sampleHomePageData: HomePageData = {
  photo: "kari.jpg",
  blurb: "Welcome to the site",
};

setupServiceTestHooks();

describe("HomePageService.getFromApi", () => {
  it("sends a bearer token and returns the parsed data", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => sampleHomePageData,
    });

    const result = await HomePageService.getFromApi(getToken);

    expect(result).toEqual(sampleHomePageData);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(API_HOME_PAGE_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the API responds with an error so the editor can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(HomePageService.getFromApi(getToken)).rejects.toThrow(
      "Failed to fetch home page data (HTTP 500)",
    );
  });
});

describe("HomePageService.getFromS3", () => {
  it("fetches the public json without a token", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => sampleHomePageData,
    });
    const result = await HomePageService.getFromS3();
    expect(result).toEqual(sampleHomePageData);
    expect(fetchMock).toHaveBeenCalledWith(S3_HOME_PAGE_URL);
  });

  it("throws an HttpError on a non-ok response so pages can show an error state", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    const error = await HomePageService.getFromS3().catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Failed to fetch home page data (HTTP 404)");
  });
});

describe("HomePageService.update", () => {
  it("PUTs the data as json with auth and content-type headers", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => sampleHomePageData,
    });

    await HomePageService.update(sampleHomePageData, getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_HOME_PAGE_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify(sampleHomePageData),
    });
  });

  it("throws when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      HomePageService.update(sampleHomePageData, getToken),
    ).rejects.toThrow("Failed to save home page data (HTTP 401)");
  });
});
