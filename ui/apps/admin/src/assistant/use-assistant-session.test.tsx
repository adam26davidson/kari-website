import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpError } from "@kari/shared/services/http-error";
import {
  CONVERSATION_FULL_MESSAGE,
  SEND_FAILED_MESSAGE,
  SESSION_STORAGE_KEY,
  defaultStorage,
  useAssistantSession,
  type StorageLike,
} from "./use-assistant-session";

const { service } = vi.hoisted(() => ({
  service: {
    getStatus: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock("@kari/shared/services/assistant", () => ({
  AssistantService: service,
}));

const getToken = vi.fn().mockResolvedValue("token");

/** An in-memory stand-in for local storage. */
function fakeStorage(initial?: Record<string, string>): StorageLike {
  const store = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

/** Storage that throws on every operation, as a locked-down browser does. */
const hostileStorage: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const available = () =>
  service.getStatus.mockResolvedValue({ available: true, canFile: false });

function setup(storage: StorageLike | null = fakeStorage()) {
  return renderHook(() => useAssistantSession(getToken, storage));
}

describe("useAssistantSession", () => {
  it("asks the API nothing until the panel is opened", async () => {
    available();
    const { result } = setup();
    expect(result.current.phase).toBe("idle");
    expect(service.getStatus).not.toHaveBeenCalled();

    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("rests when the helper has no api key", async () => {
    service.getStatus.mockResolvedValue({ available: false, canFile: false });
    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("resting"));
  });

  it("rests when the status call fails outright", async () => {
    service.getStatus.mockRejectedValue(new HttpError("nope", 500));
    const { result } = setup();
    act(() => result.current.begin());
    // The admin must keep working without the helper, so a failure here is
    // never surfaced as a broken page.
    await waitFor(() => expect(result.current.phase).toBe("resting"));
  });

  it("creates the conversation on the first message, not on open", async () => {
    available();
    const storage = fakeStorage();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "Hello to you." },
      ],
      turnsRemaining: 39,
    });

    const { result } = setup(storage);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // Merely opening the panel leaves nothing behind.
    expect(service.createSession).not.toHaveBeenCalled();

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("Hello", { route: "/haiku" });
    });

    expect(sent).toBe(true);
    expect(result.current.messages).toEqual([
      { role: "user", text: "Hello" },
      { role: "assistant", text: "Hello to you." },
    ]);
    expect(service.sendMessage).toHaveBeenCalledWith(
      "s1",
      "Hello",
      { route: "/haiku" },
      getToken,
    );
    // Remembered, so a reload finds the same conversation.
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe("s1");
  });

  it("reuses the session for later messages", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 38,
    });

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => void (await result.current.send("One", {})));
    await act(async () => void (await result.current.send("Two", {})));

    expect(service.createSession).toHaveBeenCalledTimes(1);
    expect(service.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("brings the conversation back after a reload", async () => {
    available();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Where were we." }],
      turnsRemaining: 30,
    });

    const { result } = setup(fakeStorage({ [SESSION_STORAGE_KEY]: "old" }));
    act(() => result.current.begin());

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(service.getSession).toHaveBeenCalledWith("old", getToken);
    expect(result.current.messages).toEqual([
      { role: "assistant", text: "Where were we." },
    ]);
  });

  it("starts fresh when the remembered conversation has ended", async () => {
    available();
    service.getSession.mockRejectedValue(new HttpError("gone", 404));
    const storage = fakeStorage({ [SESSION_STORAGE_KEY]: "old" });

    const { result } = setup(storage);
    act(() => result.current.begin());

    // Not an error state: she just gets the empty greeting again.
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.messages).toEqual([]);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("rests when restoring fails for any other reason", async () => {
    available();
    service.getSession.mockRejectedValue(new HttpError("boom", 500));
    const { result } = setup(fakeStorage({ [SESSION_STORAGE_KEY]: "old" }));
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("resting"));
  });

  it("keeps nothing and says so when a send fails", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockRejectedValue(new Error("offline"));

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("Hello", {});
    });

    expect(sent).toBe(false);
    expect(result.current.error).toBe(SEND_FAILED_MESSAGE);
    // The optimistic line is withdrawn — the widget puts her words back in
    // the box, and showing both would duplicate the message.
    expect(result.current.messages).toEqual([]);
  });

  it("rests when a send is answered with a 503", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockRejectedValue(new HttpError("resting", 503));

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => void (await result.current.send("Hello", {})));

    expect(result.current.phase).toBe("resting");
  });

  it("says the conversation is full when a send is capped", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 0,
    });
    service.sendMessage.mockRejectedValue(new HttpError("enough", 429));

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => void (await result.current.send("Hello", {})));

    expect(result.current.error).toBe(CONVERSATION_FULL_MESSAGE);
    // Still ready: a new conversation works, which is what the message says.
    expect(result.current.phase).toBe("ready");
  });

  it("ignores an empty message", async () => {
    available();
    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("   ", {});
    });
    expect(sent).toBe(false);
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("forgets the conversation when she starts again", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [{ role: "user", text: "Hello" }],
      turnsRemaining: 39,
    });
    const storage = fakeStorage();

    const { result } = setup(storage);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => void (await result.current.send("Hello", {})));

    act(() => result.current.startOver());

    expect(result.current.messages).toEqual([]);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    // The next message opens a brand new conversation.
    await act(async () => void (await result.current.send("Again", {})));
    expect(service.createSession).toHaveBeenCalledTimes(2);
  });

  it("works when storage throws on every call", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [{ role: "assistant", text: "Fine." }],
      turnsRemaining: 39,
    });

    const { result } = setup(hostileStorage);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("Hello", {});
    });

    // The conversation works; it simply will not survive a reload.
    expect(sent).toBe(true);
    expect(result.current.messages).toEqual([
      { role: "assistant", text: "Fine." },
    ]);
    act(() => result.current.startOver());
    expect(result.current.messages).toEqual([]);
  });

  it("works when there is no storage at all", async () => {
    available();
    const { result } = setup(null);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(service.getSession).not.toHaveBeenCalled();
  });
});

describe("defaultStorage", () => {
  it("returns the browser's local storage", () => {
    expect(defaultStorage()).toBe(window.localStorage);
  });

  it("returns null when reaching for it throws", () => {
    // Some hardened profiles throw on the property access itself, not just
    // on get/set — which is why the guard wraps the access.
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(defaultStorage()).toBeNull();
    spy.mockRestore();
  });
});
