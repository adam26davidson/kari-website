import { describe, it, expect } from "vitest";
import { AssistantService } from "./assistant";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

const STATUS_URL = "https://api.test.local/assistant/status";
const SESSIONS_URL = "https://api.test.local/assistant/sessions";

const session = {
  id: "abc",
  messages: [{ role: "assistant" as const, text: "Hello" }],
  turnsRemaining: 39,
};

setupServiceTestHooks();

describe("AssistantService.getStatus", () => {
  it("sends a bearer token and returns what the helper can do", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ available: true, canFile: false }),
    });

    const result = await AssistantService.getStatus(getToken);

    expect(result).toEqual({ available: true, canFile: false });
    expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the status call fails so the panel can rest", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(AssistantService.getStatus(getToken)).rejects.toThrow(
      "Failed to reach the helper (HTTP 500)",
    );
  });
});

describe("AssistantService.createSession", () => {
  it("POSTs to start a conversation", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => session });

    const result = await AssistantService.createSession(getToken);

    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(SESSIONS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws an HttpError carrying the status when it cannot start", async () => {
    mockFetchOnce({ ok: false, status: 503, json: async () => ({}) });
    // 503 is the helper resting; the panel branches on the status, so it
    // has to survive the throw.
    const failure = AssistantService.createSession(getToken);
    await expect(failure).rejects.toThrow(
      "Failed to start a conversation (HTTP 503)",
    );
    await expect(failure).rejects.toMatchObject({
      name: "HttpError",
      status: 503,
    });
  });
});

describe("AssistantService.getSession", () => {
  it("fetches one conversation by id", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => session });

    const result = await AssistantService.getSession("abc", getToken);

    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(`${SESSIONS_URL}/abc`, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("escapes the id so a stored value can never build a path", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => session });
    await AssistantService.getSession("a/b", getToken);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SESSIONS_URL}/a%2Fb`,
      expect.anything(),
    );
  });

  it("throws a 404 HttpError when the conversation has ended", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    // The panel reads this status to decide to start fresh rather than to
    // show an error.
    await expect(
      AssistantService.getSession("abc", getToken),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("AssistantService.sendMessage", () => {
  it("POSTs her words with the page context and returns the transcript", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => session });

    const result = await AssistantService.sendMessage(
      "abc",
      "How do I add a haiku?",
      { route: "/haiku", dirty: false },
      getToken,
    );

    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(`${SESSIONS_URL}/abc/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        text: "How do I add a haiku?",
        context: { route: "/haiku", dirty: false },
      }),
    });
  });

  it("throws with the status so the panel can tell resting from full", async () => {
    mockFetchOnce({ ok: false, status: 429, json: async () => ({}) });
    await expect(
      AssistantService.sendMessage("abc", "Hi", {}, getToken),
    ).rejects.toMatchObject({ status: 429 });
  });
});
