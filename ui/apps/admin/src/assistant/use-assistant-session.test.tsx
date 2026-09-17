import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpError } from "@kari/shared/services/http-error";
import {
  ENOUGH_FOR_NOW_MESSAGE,
  FILING_FAILED_MESSAGE,
  RESTORE_FAILED_MESSAGE,
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
    fileIssue: vi.fn(),
    dismissDraft: vi.fn(),
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

/** A helper that can both talk and write things down. */
const canFile = () =>
  service.getStatus.mockResolvedValue({ available: true, canFile: true });

/** The draft the helper puts on screen, as the API returns it. */
const DRAFT = {
  kind: "bug",
  title: "Photographs come out sideways",
  summary: "Your upright photographs are showing on their side.",
};

function setup(storage: StorageLike | null = fakeStorage()) {
  return renderHook(() => useAssistantSession(getToken, storage));
}

/** Get to the state the decision tests are about: a card on screen. */
async function withADraft() {
  canFile();
  service.createSession.mockResolvedValue({
    id: "s1",
    messages: [],
    turnsRemaining: 40,
    draft: null,
  });
  service.sendMessage.mockResolvedValue({
    id: "s1",
    messages: [{ role: "assistant", text: "Have a look at this." }],
    turnsRemaining: 39,
    draft: DRAFT,
  });

  const rendered = setup();
  act(() => rendered.result.current.begin());
  await waitFor(() => expect(rendered.result.current.phase).toBe("ready"));
  await act(
    async () => void (await rendered.result.current.send("Photos", {})),
  );
  expect(rendered.result.current.draft).toEqual(DRAFT);
  return rendered;
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

  it("stays usable when the remembered conversation cannot be read", async () => {
    available();
    service.getSession.mockRejectedValue(new HttpError("boom", 500));
    service.createSession.mockResolvedValue({
      id: "s2",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s2",
      messages: [{ role: "assistant", text: "Fresh start." }],
      turnsRemaining: 39,
    });
    const storage = fakeStorage({ [SESSION_STORAGE_KEY]: "corrupt" });

    const { result } = setup(storage);
    act(() => result.current.begin());

    // The API answers 500 — deliberately — for a conversation whose stored
    // JSON is corrupt, so "resting" here was a one-way door: the id stayed,
    // every reload repeated the same failure, and the resting state has no
    // Start again to escape by.
    await waitFor(() =>
      expect(result.current.error).toBe(RESTORE_FAILED_MESSAGE),
    );
    expect(result.current.phase).toBe("ready");
    expect(result.current.messages).toEqual([]);

    await act(async () => void (await result.current.send("Hello", {})));
    expect(result.current.messages).toEqual([
      { role: "assistant", text: "Fresh start." },
    ]);
    // Her first message writes a new id over the unreadable one, so the
    // problem cannot outlive the conversation it came from.
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe("s2");
  });

  it("asks again when she reopens a resting panel", async () => {
    service.getStatus.mockRejectedValueOnce(new HttpError("down", 500));
    service.getStatus.mockResolvedValue({ available: true, canFile: false });

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("resting"));

    // One status blip should not need a page reload to recover from: opening
    // the panel again asks again.
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("drops a reply that lands after she has started again", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    let land: (session: unknown) => void = () => {};
    service.sendMessage.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const storage = fakeStorage();

    const { result } = setup(storage);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: Promise<boolean> | undefined;
    await act(async () => {
      sent = result.current.send("Hello", {});
    });
    await waitFor(() => expect(result.current.sending).toBe(true));

    act(() => result.current.startOver());
    expect(result.current.messages).toEqual([]);
    // She is not made to sit out the rest of a turn she abandoned — an Opus
    // answer can take most of three minutes.
    expect(result.current.sending).toBe(false);

    await act(async () => {
      land({
        id: "s1",
        messages: [
          { role: "user", text: "Hello" },
          { role: "assistant", text: "Hello to you." },
        ],
        turnsRemaining: 39,
      });
      await sent;
    });

    // The reply belonged to the conversation she cleared, so it must not
    // paint itself back over the empty panel.
    expect(result.current.messages).toEqual([]);
    expect(result.current.sending).toBe(false);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    // Nothing to put back in the box either: those words went with it.
    await expect(sent).resolves.toBe(true);
  });

  it("does not remember a conversation she abandoned while it was being made", async () => {
    available();
    let made: (session: unknown) => void = () => {};
    service.createSession.mockReturnValue(
      new Promise((resolve) => {
        made = resolve;
      }),
    );
    const storage = fakeStorage();

    const { result } = setup(storage);
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: Promise<boolean> | undefined;
    await act(async () => {
      sent = result.current.send("Hello", {});
    });
    act(() => result.current.startOver());

    await act(async () => {
      made({ id: "s1", messages: [], turnsRemaining: 40 });
      await sent;
    });

    // The message is never sent, and the id she just cleared is not written
    // back over the top of the clearing.
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("drops a failure that lands after she has started again", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    let fail: (reason: unknown) => void = () => {};
    service.sendMessage.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    let sent: Promise<boolean> | undefined;
    await act(async () => {
      sent = result.current.send("Hello", {});
    });
    await waitFor(() => expect(result.current.sending).toBe(true));

    act(() => result.current.startOver());
    await act(async () => {
      fail(new HttpError("boom", 503));
      await sent;
    });

    // No error about a conversation she is no longer having.
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([]);
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

  it("stays usable when a send is answered with a 503", async () => {
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

    // One upstream blip must not fold the conversation away: the message
    // tells her to try again in a moment, so trying again has to be possible
    // without reloading the page.
    expect(result.current.phase).toBe("ready");
    expect(result.current.error).toBe(SEND_FAILED_MESSAGE);

    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [{ role: "assistant", text: "There you are." }],
      turnsRemaining: 39,
    });
    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send("Hello", {});
    });
    expect(sent).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("says the helper has had enough when a send is capped", async () => {
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

    // Both halves are needed: the same 429 covers a conversation that has run
    // its length and the day's total across all of them, and only "try again
    // later" is true of the second.
    expect(result.current.error).toBe(ENOUGH_FOR_NOW_MESSAGE);
    expect(result.current.error).toMatch(/Start a new conversation/);
    expect(result.current.error).toMatch(/try again later/);
    // Still ready either way, so neither remedy is out of reach.
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

  it("has no draft and cannot file until the helper says otherwise", async () => {
    available();
    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(result.current.draft).toBeNull();
    expect(result.current.canFile).toBe(false);
  });

  it("files the draft only when she says so", async () => {
    canFile();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
      draft: null,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [
        { role: "user", text: "Photos are sideways" },
        { role: "assistant", text: "Have a look at this." },
      ],
      turnsRemaining: 39,
      draft: DRAFT,
    });
    service.fileIssue.mockResolvedValue({
      id: "s1",
      messages: [
        { role: "user", text: "Photos are sideways" },
        { role: "assistant", text: "Have a look at this." },
        {
          role: "assistant",
          text: "Filed — I'll make sure it gets looked at.",
          issue: { number: 7, url: "https://example.test/7", title: DRAFT.title },
        },
      ],
      turnsRemaining: 39,
      draft: null,
    });

    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.canFile).toBe(true));
    await act(async () => void (await result.current.send("Photos are sideways", {})));

    // The helper's tool can do no more than this: put a card on screen.
    expect(result.current.draft).toEqual(DRAFT);
    expect(service.fileIssue).not.toHaveBeenCalled();

    await act(async () => await result.current.fileIssue());

    expect(service.fileIssue).toHaveBeenCalledWith("s1", getToken);
    // The confirmation arrives as an ordinary line of the transcript, with
    // somewhere to look — so a reload shows exactly what filing showed.
    expect(result.current.messages.at(-1)?.issue?.number).toBe(7);
    expect(result.current.draft).toBeNull();
    expect(result.current.draftError).toBeNull();
  });

  it("lets the draft go without filing anything", async () => {
    const { result } = await withADraft();
    service.dismissDraft.mockResolvedValue({
      id: "s1",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 39,
      draft: null,
    });

    await act(async () => await result.current.dismissDraft());

    expect(service.dismissDraft).toHaveBeenCalledWith("s1", getToken);
    expect(service.fileIssue).not.toHaveBeenCalled();
    expect(result.current.draft).toBeNull();
  });

  it("keeps the card when filing does not land", async () => {
    const { result } = await withADraft();
    service.fileIssue.mockRejectedValue(new HttpError("no", 503));

    await act(async () => await result.current.fileIssue());

    // The server keeps the draft on every failure, so the card has to stay:
    // pressing the button again is the remedy the message promises.
    expect(result.current.draftError).toBe(FILING_FAILED_MESSAGE);
    expect(result.current.draft).toEqual(DRAFT);
    expect(result.current.deciding).toBe(false);
  });

  it("brings a draft back with the conversation after a reload", async () => {
    canFile();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });

    const { result } = setup(fakeStorage({ [SESSION_STORAGE_KEY]: "old" }));
    act(() => result.current.begin());

    // A decision she was partway through is not lost to a page reload.
    await waitFor(() => expect(result.current.draft).toEqual(DRAFT));
  });

  it("takes the card with the conversation she clears", async () => {
    const { result } = await withADraft();
    act(() => result.current.startOver());
    expect(result.current.draft).toBeNull();
  });

  it("does nothing with a draft when there is no conversation yet", async () => {
    canFile();
    const { result } = setup();
    act(() => result.current.begin());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => await result.current.fileIssue());
    expect(service.fileIssue).not.toHaveBeenCalled();
  });

  it("drops a filing that lands after she has started again", async () => {
    const { result } = await withADraft();
    let land: (session: unknown) => void = () => {};
    service.fileIssue.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );

    let filing: Promise<void> | undefined;
    await act(async () => {
      filing = result.current.fileIssue();
    });
    act(() => result.current.startOver());

    await act(async () => {
      land({ id: "s1", messages: [], turnsRemaining: 39, draft: null });
      await filing;
    });

    // Nothing from the conversation she cleared comes back, not even a
    // confirmation for something that did get filed.
    expect(result.current.messages).toEqual([]);
    expect(result.current.deciding).toBe(false);
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
