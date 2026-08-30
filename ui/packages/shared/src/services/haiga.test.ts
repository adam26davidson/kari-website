import { describe, it, expect } from "vitest";
import { HaigaService } from "./haiga";
import { Haiga } from "../models";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

const API_HAIGA_URL = "https://api.test.local/haiga";
const S3_HAIGA_URL = "https://s3.test.local/haiga.json";

const sampleHaiga: Haiga = {
  id: "1",
  lines: ["winter moon", "a bridge without a railing", "over the gorge"],
  publisher: "kari",
  image: "moon.jpg",
};

setupServiceTestHooks();

describe("HaigaService.getListFromApi", () => {
  it("sends a bearer token and returns the parsed list", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiga],
    });

    const result = await HaigaService.getListFromApi(getToken);

    expect(result).toEqual([sampleHaiga]);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(API_HAIGA_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the API responds with an error so the admin UI can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(HaigaService.getListFromApi(getToken)).rejects.toThrow(
      "Failed to fetch haiga list (HTTP 500)",
    );
  });
});

describe("HaigaService.getListFromS3", () => {
  it("fetches the public json without a token", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiga],
    });
    const result = await HaigaService.getListFromS3();
    expect(result).toEqual([sampleHaiga]);
    expect(fetchMock).toHaveBeenCalledWith(S3_HAIGA_URL);
  });

  it("throws on a non-ok response so pages can show an error state", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(HaigaService.getListFromS3()).rejects.toThrow(
      "Failed to fetch haiga list (HTTP 404)",
    );
  });
});

describe("HaigaService.updateList", () => {
  it("PUTs the list as json with auth and content-type headers", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiga],
    });

    await HaigaService.updateList([sampleHaiga], getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_HAIGA_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify([sampleHaiga]),
    });
  });

  it("throws an HttpError when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    const failure = HaigaService.updateList([sampleHaiga], getToken);
    await expect(failure).rejects.toThrow(
      "Failed to update haiga list (HTTP 401)",
    );
    await expect(failure).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });
});
