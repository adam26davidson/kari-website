import { describe, it, expect } from "vitest";
import { authorizedFetch, ensureOk, readErrorText } from "./http";
import { HttpError } from "./http-error";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

setupServiceTestHooks();

describe("authorizedFetch", () => {
  it("fetches with a bearer header from the token getter", async () => {
    const fetchMock = mockFetchOnce({ ok: true });

    const response = await authorizedFetch("https://x.test/a", getToken);

    expect(response.ok).toBe(true);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://x.test/a", {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("merges the bearer header into the init's method, body, and headers", async () => {
    const fetchMock = mockFetchOnce({ ok: true });

    await authorizedFetch("https://x.test/a", getToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://x.test/a", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: "[]",
    });
  });

  it("does not fetch at all when the token getter rejects", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    getToken.mockRejectedValue(new Error("login required"));

    await expect(
      authorizedFetch("https://x.test/a", getToken),
    ).rejects.toThrow("login required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ensureOk", () => {
  it("does nothing for an ok response", () => {
    expect(() => ensureOk({ ok: true } as Response, "Failed")).not.toThrow();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("throws an HttpError carrying the status for a non-ok response", () => {
    const response = { ok: false, status: 404 } as Response;
    let thrown: unknown;
    try {
      ensureOk(response, "Failed to fetch thing");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpError);
    expect((thrown as HttpError).status).toBe(404);
    expect((thrown as HttpError).message).toBe(
      "Failed to fetch thing (HTTP 404)",
    );
    // Without a logAs, the thrown phrase is also the console label.
    expect(console.error).toHaveBeenCalledWith("Failed to fetch thing", 404);
  });

  it("logs the more specific logAs label while throwing the generic message", () => {
    const response = { ok: false, status: 500 } as Response;
    expect(() =>
      ensureOk(response, "Failed to fetch thing", "Failed to fetch from S3"),
    ).toThrow("Failed to fetch thing (HTTP 500)");
    expect(console.error).toHaveBeenCalledWith("Failed to fetch from S3", 500);
  });
});

describe("readErrorText", () => {
  it("returns the response body text", async () => {
    const response = { text: async () => "S3 exploded" } as Response;
    expect(await readErrorText(response)).toBe("S3 exploded");
  });

  it("returns an empty string when the body cannot be read", async () => {
    const response = {
      text: async () => {
        throw new Error("body stream lost");
      },
    } as unknown as Response;
    expect(await readErrorText(response)).toBe("");
  });
});
