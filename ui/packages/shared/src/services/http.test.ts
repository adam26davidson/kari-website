import { describe, it, expect, vi } from "vitest";
import {
  authorizedFetch,
  authorizedUpload,
  ensureOk,
  readErrorText,
} from "./http";
import { HttpError } from "./http-error";
import {
  getToken,
  mockFetchOnce,
  setupServiceTestHooks,
  stubXhr,
} from "./test-helpers";

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

describe("authorizedUpload", () => {
  const url = "https://x.test/images";

  it("POSTs the form to the url with a bearer header", async () => {
    const requests = stubXhr({ status: 200, responseText: "{}" });
    const form = new FormData();
    form.append("file", new File(["x"], "a.png"));

    await authorizedUpload(url, getToken, form);

    expect(requests).toHaveLength(1);
    const [xhr] = requests;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(url);
    // Only the bearer header: the browser writes the multipart
    // Content-Type, boundary included, for a FormData body.
    expect(xhr.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(xhr.body).toBe(form);
  });

  it("resolves a Response carrying the status and body", async () => {
    stubXhr({
      status: 200,
      statusText: "OK",
      responseText: '{"fileName":"a.webp"}',
    });

    const response = await authorizedUpload(url, getToken, new FormData());

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(await response.json()).toEqual({ fileName: "a.webp" });
  });

  // A failed upload is still an answer, not a network failure: ensureOk
  // in the caller is what turns it into the HttpError the page explains.
  it("resolves a non-ok response rather than rejecting", async () => {
    stubXhr({ status: 500, responseText: "boom" });

    const response = await authorizedUpload(url, getToken, new FormData());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("boom");
  });

  // `new Response("", { status: 204 })` throws: a null-body status must be
  // given a null body.
  it("copes with an empty body on a no-content status", async () => {
    stubXhr({ status: 204 });

    const response = await authorizedUpload(url, getToken, new FormData());

    expect(response.status).toBe(204);
  });

  it("reports the fraction sent for a measurable progress event", async () => {
    const onProgress = vi.fn();
    const requests = stubXhr({ status: 200, autoComplete: false });
    const pending = authorizedUpload(url, getToken, new FormData(), onProgress);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const [xhr] = requests;

    xhr.upload.emit("progress", {
      lengthComputable: true,
      loaded: 25,
      total: 100,
    });
    expect(onProgress).toHaveBeenLastCalledWith(0.25);

    // A progress event that cannot say how much is left says nothing.
    xhr.upload.emit("progress", { lengthComputable: false, loaded: 50 });
    expect(onProgress).toHaveBeenCalledOnce();

    // The upload finishing reports exactly 1, even if the last progress
    // event stopped short of the total.
    xhr.upload.emit("load");
    expect(onProgress).toHaveBeenLastCalledWith(1);

    xhr.emit("load");
    await expect(pending).resolves.toBeInstanceOf(Response);
  });

  it("uploads without a progress callback", async () => {
    // The default stub fires a progress event and the upload's load, so
    // both listeners run with nothing to report to.
    stubXhr({ status: 200, responseText: "{}" });

    const response = await authorizedUpload(url, getToken, new FormData());

    expect(response.ok).toBe(true);
  });

  it("rejects when the request fails at the network", async () => {
    const requests = stubXhr({ status: 0, autoComplete: false });
    const pending = authorizedUpload(url, getToken, new FormData());
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    requests[0].emit("error");

    await expect(pending).rejects.toThrow(TypeError);
  });

  it("does not open a request at all when the token getter rejects", async () => {
    const requests = stubXhr({ status: 200 });
    getToken.mockRejectedValue(new Error("login required"));

    await expect(
      authorizedUpload(url, getToken, new FormData()),
    ).rejects.toThrow("login required");
    expect(requests).toHaveLength(0);
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
