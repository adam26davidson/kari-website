import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HaikuService } from "./haiku";
import { Haiku } from "../Models";

const API_HAIKU_URL = "https://api.test.local/haiku";
const S3_HAIKU_URL = "https://s3.test.local/haiku.json";

const sampleHaiku: Haiku = {
  id: "1",
  lines: [
    "an old silent pond",
    "a frog jumps into the pond",
    "splash! silence again",
  ],
  publisher: "kari",
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

describe("HaikuService.getListFromApi", () => {
  it("sends a bearer token and returns the parsed list", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiku],
    });

    const result = await HaikuService.getListFromApi(getToken);

    expect(result).toEqual([sampleHaiku]);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(API_HAIKU_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the API responds with an error so the admin UI can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(HaikuService.getListFromApi(getToken)).rejects.toThrow(
      "Failed to fetch haiku list (HTTP 500)",
    );
  });
});

describe("HaikuService.getListFromS3", () => {
  it("fetches the public json without a token", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiku],
    });
    const result = await HaikuService.getListFromS3();
    expect(result).toEqual([sampleHaiku]);
    expect(fetchMock).toHaveBeenCalledWith(S3_HAIKU_URL);
  });

  it("throws on a non-ok response so pages can show an error state", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(HaikuService.getListFromS3()).rejects.toThrow(
      "Failed to fetch haiku list (HTTP 404)",
    );
  });
});

describe("HaikuService.updateList", () => {
  it("PUTs the list as json with auth and content-type headers", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [sampleHaiku],
    });

    await HaikuService.updateList([sampleHaiku], getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_HAIKU_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify([sampleHaiku]),
    });
  });

  it("throws an HttpError when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    const failure = HaikuService.updateList([sampleHaiku], getToken);
    await expect(failure).rejects.toThrow(
      "Failed to update haiku list (HTTP 401)",
    );
    await expect(failure).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });
});
