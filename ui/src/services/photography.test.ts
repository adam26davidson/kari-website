import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PhotographyService } from "./photography";
import { PhotographyPost } from "../Models";

const API_URL = "https://api.test.local/photography";
const S3_URL = "https://s3.test.local/photography.json";

const samplePost: PhotographyPost = {
  id: "p1",
  title: "Coast",
  subtitle: "Oregon",
  blurb: "fog over the dunes",
  images: [{ image: "coast.jpg", blurb: "dunes" }],
};

function mockFetchOnce(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const getToken = vi.fn().mockResolvedValue("test-token");

beforeEach(() => {
  // keep test output clean; the service logs on both success and error paths
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-establish each test: the global afterEach runs vi.restoreAllMocks().
  getToken.mockReset();
  getToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PhotographyService.getListFromApi", () => {
  it("sends a bearer token and returns the parsed list", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [samplePost],
    });

    const result = await PhotographyService.getListFromApi(getToken);

    expect(result).toEqual([samplePost]);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(API_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the API responds with an error so the admin UI can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(PhotographyService.getListFromApi(getToken)).rejects.toThrow(
      "Failed to fetch photography post list (HTTP 500)",
    );
  });
});

describe("PhotographyService.getListFromS3", () => {
  it("fetches the public json without a token", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [samplePost],
    });
    const result = await PhotographyService.getListFromS3();
    expect(result).toEqual([samplePost]);
    expect(fetchMock).toHaveBeenCalledWith(S3_URL);
  });

  it("throws on a non-ok response so pages can show an error state", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(PhotographyService.getListFromS3()).rejects.toThrow(
      "Failed to fetch photography post list (HTTP 404)",
    );
  });
});

describe("PhotographyService.updateList", () => {
  it("PUTs the list as json with auth and content-type headers", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [samplePost],
    });

    await PhotographyService.updateList([samplePost], getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify([samplePost]),
    });
  });

  it("throws an HttpError when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    const failure = PhotographyService.updateList([samplePost], getToken);
    await expect(failure).rejects.toThrow(
      "Failed to update photography post list (HTTP 401)",
    );
    await expect(failure).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });
});
