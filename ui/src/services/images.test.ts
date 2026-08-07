import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ImageService } from "./images";

const API_IMAGES_URL = "https://api.test.local/images";

// Pin the generated filename so upload assertions are deterministic.
vi.mock("uuid", () => ({ v4: () => "fixed-uuid" }));

function mockFetchOnce(
  response: Partial<Response> & {
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  },
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

describe("ImageService.upload", () => {
  it("returns null without fetching when no file is provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, text: async () => "" });
    expect(await ImageService.upload(null, true, getToken)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the file and returns the server-stored name", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({
        message: "File uploaded successfully",
        fileName: "server-uuid.png",
      }),
    });
    const file = new File(["PNGDATA"], "photo.png", { type: "image/png" });

    const result = await ImageService.upload(file, true, getToken);

    // The name the API stored the image under wins over the sent name.
    expect(result).toBe("server-uuid.png");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_IMAGES_URL}?isPublished=true`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-token" });
    const uploaded = (init.body as FormData).get("file") as File;
    expect(uploaded.name).toBe("fixed-uuid.png");
    expect(uploaded.type).toBe("image/png");
    // jsdom's File lacks .text(); the byte count confirms the data came along.
    expect(uploaded.size).toBe("PNGDATA".length);
  });

  it("sends a file with no extension as just the uuid", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ fileName: "server-uuid" }),
    });
    const file = new File(["RAW"], "photo", { type: "image/png" });

    const result = await ImageService.upload(file, true, getToken);

    expect(result).toBe("server-uuid");
    const uploaded = (fetchMock.mock.calls[0][1].body as FormData).get(
      "file",
    ) as File;
    expect(uploaded.name).toBe("fixed-uuid");
  });

  it("falls back to the sent name when the API returns no fileName", async () => {
    // An older API stores the sent name verbatim and only returns a
    // message, so the sent (already unique) name is the stored one.
    mockFetchOnce({
      ok: true,
      json: async () => ({ message: "File uploaded successfully" }),
    });
    const file = new File(["PNGDATA"], "photo.png", { type: "image/png" });

    expect(await ImageService.upload(file, true, getToken)).toBe(
      "fixed-uuid.png",
    );
  });

  it("passes isPublished=false through to the query string", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ fileName: "server-uuid.jpg" }),
    });
    const file = new File(["JPG"], "draft.jpg", { type: "image/jpeg" });

    await ImageService.upload(file, false, getToken);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API_IMAGES_URL}?isPublished=false`,
    );
  });

  it("throws when the upload fails so the editor can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 500, text: async () => "" });
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await expect(ImageService.upload(file, true, getToken)).rejects.toThrow(
      "HTTP error! status: 500",
    );
  });
});

describe("ImageService.delete", () => {
  it("DELETEs the image by filename with auth", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await ImageService.delete("fixed-uuid.png", getToken);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_IMAGES_URL}/fixed-uuid.png`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer test-token" },
      },
    );
  });

  it("throws when the delete fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      ImageService.delete("fixed-uuid.png", getToken),
    ).rejects.toThrow("Failed to delete image: fixed-uuid.png");
  });
});

describe("ImageService.setPublished", () => {
  it("PUTs the publish flag via the query param only, with no body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await ImageService.setPublished("fixed-uuid.png", true, getToken);

    // The API reads isPublished from the query param; a JSON body is dead weight.
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_IMAGES_URL}/fixed-uuid.png/set-published?isPublished=true`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer test-token" },
      },
    );
  });

  it("throws including the server's error text when the request fails", async () => {
    mockFetchOnce({ ok: false, status: 500, text: async () => "S3 exploded" });
    await expect(
      ImageService.setPublished("fixed-uuid.png", true, getToken),
    ).rejects.toThrow(
      "Failed to set image published status: fixed-uuid.png. Error: S3 exploded",
    );
  });
});

describe("ImageService.gc", () => {
  const report = {
    dry_run: true,
    referenced: ["images/kept.png"],
    orphaned: ["images/orphan.png"],
    skipped_recent: [],
    deleted: [],
  };

  it("POSTs a dry run with auth and returns the report", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => report });

    const result = await ImageService.gc(true, getToken);

    expect(result).toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith(`${API_IMAGES_URL}/gc?dry_run=true`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("passes dry_run=false through for the real sweep", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ ...report, dry_run: false }),
    });

    await ImageService.gc(false, getToken);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API_IMAGES_URL}/gc?dry_run=false`,
    );
  });

  it("throws an HttpError including the server's error text on failure", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      text: async () => "Image GC aborted before any delete",
    });
    await expect(ImageService.gc(true, getToken)).rejects.toThrow(
      "Image cleanup failed (HTTP 500): Image GC aborted before any delete",
    );
  });

  it("still throws a status-only message when the error body is unreadable", async () => {
    mockFetchOnce({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("body stream lost");
      },
    });
    await expect(ImageService.gc(true, getToken)).rejects.toThrow(
      "Image cleanup failed (HTTP 502)",
    );
  });
});
