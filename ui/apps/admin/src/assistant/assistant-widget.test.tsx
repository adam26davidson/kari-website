import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { HttpError } from "@kari/shared/services/http-error";
import { AssistantWidget } from "./assistant-widget";
import { PUBLIC_ISSUE_NOTE } from "./assistant-draft-card";
import { AssistantProvider } from "./assistant-provider";
import { useAssistantSubject } from "./use-assistant-subject";
import { SESSION_STORAGE_KEY, type StorageLike } from "./use-assistant-session";

const { service, getToken } = vi.hoisted(() => ({
  service: {
    getStatus: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    sendMessage: vi.fn(),
    fileIssue: vi.fn(),
    dismissDraft: vi.fn(),
  },
  // Stable across renders: the session hook has it in an effect's
  // dependencies, so a fresh function each render would loop.
  getToken: vi.fn(),
}));

vi.mock("@kari/shared/services/assistant", () => ({
  AssistantService: service,
}));
vi.mock("../hooks/use-admin-token", () => ({ useAdminToken: () => getToken }));

beforeAll(() => {
  // jsdom lays nothing out and has no scrollIntoView; the panel calls it to
  // keep the newest line in view.
  Element.prototype.scrollIntoView = vi.fn();
});

function fakeStorage(initial?: Record<string, string>): StorageLike {
  const store = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

const available = () =>
  service.getStatus.mockResolvedValue({ available: true, canFile: false });

/** A helper that can both talk and write things down. */
const filing = () =>
  service.getStatus.mockResolvedValue({ available: true, canFile: true });

/** The draft the helper puts on screen, as the API returns it. */
const DRAFT = {
  kind: "bug",
  title: "Photographs come out sideways",
  summary: "Your upright photographs are showing on their side.",
};

function renderWidget({
  route = "/haiku",
  storage = fakeStorage(),
  subject,
}: {
  route?: string;
  storage?: StorageLike | null;
  subject?: { what?: string; title?: string; dirty?: boolean };
} = {}) {
  function Page() {
    useAssistantSubject(subject ?? {});
    return null;
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AssistantProvider>
        <Page />
        <AssistantWidget storage={storage} />
      </AssistantProvider>
    </MemoryRouter>,
  );
}

const openPanel = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Ask the helper" }));
  return screen.findByRole("dialog", { name: "The helper" });
};

describe("AssistantWidget", () => {
  it("rests in the corner until she asks for it", () => {
    available();
    renderWidget();

    expect(
      screen.getByRole("button", { name: "Ask the helper" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Opening an admin page must cost nothing.
    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it("greets her by name when opened", async () => {
    available();
    renderWidget();
    await openPanel();

    expect(await screen.findByText(/^Hi Kari/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("opens on load when the url asks it to", async () => {
    available();
    // How the screenshot capture photographs the panel open.
    renderWidget({ route: "/haiku?assistant=open" });

    expect(
      await screen.findByRole("dialog", { name: "The helper" }),
    ).toBeInTheDocument();
  });

  it("closes again", async () => {
    available();
    renderWidget();
    await openPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "Close the helper" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the resting state when the helper is switched off", async () => {
    service.getStatus.mockResolvedValue({ available: false, canFile: false });
    renderWidget();
    await openPanel();

    expect(await screen.findByText(/resting right now/)).toBeInTheDocument();
    // Nothing to type into — the panel does not offer an action that cannot
    // work.
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
  });

  it("rests when the helper cannot be reached at all", async () => {
    service.getStatus.mockRejectedValue(new HttpError("down", 500));
    renderWidget();
    await openPanel();

    expect(await screen.findByText(/resting right now/)).toBeInTheDocument();
  });

  it("shows her message and the reply, with the page she is on attached", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [
        { role: "user", text: "How do I add a haiku?" },
        { role: "assistant", text: "Open Haiku, then Add a haiku." },
      ],
      turnsRemaining: 39,
    });

    renderWidget({
      route: "/haiku/h1",
      subject: { what: "haiku", title: "Autumn rain", dirty: true },
    });
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "How do I add a haiku?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Open Haiku, then Add a haiku."),
    ).toBeInTheDocument();
    expect(screen.getByText("How do I add a haiku?")).toBeInTheDocument();
    // The route comes from the router, the rest from what the page
    // published — together they tell the helper what she is looking at.
    expect(service.sendMessage).toHaveBeenCalledWith(
      "s1",
      "How do I add a haiku?",
      { route: "/haiku/h1", what: "haiku", title: "Autumn rain", dirty: true },
      getToken,
    );
    // The box is empty again, ready for the next question.
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
      "",
    );
  });

  it("sends on Enter but not on Shift+Enter", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [{ role: "assistant", text: "Yes." }],
      turnsRemaining: 39,
    });

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    const box = screen.getByRole("textbox", { name: "Your message" });
    await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two");
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(box).toHaveValue("one\ntwo");

    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(service.sendMessage).toHaveBeenCalledTimes(1));
  });

  it("will not send an empty message", async () => {
    available();
    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "   ",
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("keeps her words in the box when the send fails", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockRejectedValue(new Error("offline"));

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    const box = screen.getByRole("textbox", { name: "Your message" });
    await userEvent.type(box, "Why is the photo sideways");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The one thing a failed send must never do is lose what she wrote.
    expect(
      await screen.findByText(/your message is still here/),
    ).toBeInTheDocument();
    expect(box).toHaveValue("Why is the photo sideways");
  });

  it("lets her try again when a send finds the helper busy", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 40,
    });
    service.sendMessage.mockRejectedValue(new HttpError("resting", 503));

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    const box = screen.getByRole("textbox", { name: "Your message" });
    await userEvent.type(box, "Why is the photo sideways");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // A blip upstream is the one case where the panel used to collapse to
    // "resting", taking the box away with her words still in it — leaving
    // her told to try again later with no way to try at all.
    expect(
      await screen.findByText(/your message is still here/),
    ).toBeInTheDocument();
    expect(box).toHaveValue("Why is the photo sideways");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();

    service.sendMessage.mockResolvedValue({
      id: "s1",
      messages: [{ role: "assistant", text: "It is the orientation tag." }],
      turnsRemaining: 39,
    });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("It is the orientation tag."),
    ).toBeInTheDocument();
  });

  it("says when the helper has talked enough for now", async () => {
    available();
    service.createSession.mockResolvedValue({
      id: "s1",
      messages: [],
      turnsRemaining: 0,
    });
    service.sendMessage.mockRejectedValue(new HttpError("enough", 429));

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "Hello",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The API sends this same 429 for the day's cap as well as this
    // conversation's, so the words must hold for both.
    expect(
      await screen.findByText(/Start a new conversation, or try again later/),
    ).toBeInTheDocument();
  });

  it("brings the conversation back after a reload", async () => {
    available();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [
        { role: "user", text: "Where were we" },
        { role: "assistant", text: "You were adding a haiku." },
      ],
      turnsRemaining: 30,
    });

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();

    expect(
      await screen.findByText("You were adding a haiku."),
    ).toBeInTheDocument();
    // The greeting belongs to an empty panel only.
    expect(screen.queryByText(/^Hi Kari/)).not.toBeInTheDocument();
  });

  it("starts fresh when the remembered conversation has ended", async () => {
    available();
    service.getSession.mockRejectedValue(new HttpError("gone", 404));
    const storage = fakeStorage({ [SESSION_STORAGE_KEY]: "old" });

    renderWidget({ storage });
    await openPanel();

    // A dead id is not an error she should ever see.
    expect(await screen.findByText(/^Hi Kari/)).toBeInTheDocument();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("still offers a conversation when the remembered one cannot be read", async () => {
    available();
    service.getSession.mockRejectedValue(new HttpError("corrupt", 500));

    renderWidget({
      storage: fakeStorage({ [SESSION_STORAGE_KEY]: "corrupt" }),
    });
    await openPanel();

    // Not the resting dead end: the helper answered, so the box stays and
    // she can start a new conversation right here.
    expect(
      await screen.findByText(/Couldn't bring your last conversation back/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/resting right now/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Your message" }),
    ).toBeInTheDocument();
  });

  it("lets her start the conversation again", async () => {
    available();
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

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "Hello",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hello to you.");

    await userEvent.click(screen.getByRole("button", { name: "Start again" }));

    expect(screen.queryByText("Hello to you.")).not.toBeInTheDocument();
    expect(screen.getByText(/^Hi Kari/)).toBeInTheDocument();
  });

  it("lets her start again while a reply is still coming", async () => {
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

    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "Why is the photo sideways",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thinking…");

    // The button is right there through the whole wait, and an Opus turn can
    // take most of three minutes.
    await userEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(await screen.findByText(/^Hi Kari/)).toBeInTheDocument();

    await act(async () => {
      land({
        id: "s1",
        messages: [
          { role: "user", text: "Why is the photo sideways" },
          { role: "assistant", text: "It is the orientation tag." },
        ],
        turnsRemaining: 39,
      });
    });

    // The cleared panel stays cleared, and her old words are not pushed back
    // into the box as if the send had failed.
    expect(
      screen.queryByText("It is the orientation tag."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
      "",
    );
  });

  it("offers starting again only once there is something to clear", async () => {
    available();
    renderWidget();
    await openPanel();
    await screen.findByText(/^Hi Kari/);

    expect(
      screen.queryByRole("button", { name: "Start again" }),
    ).not.toBeInTheDocument();
  });

  it("shows the drafted issue and files it only when she asks", async () => {
    filing();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });
    service.fileIssue.mockResolvedValue({
      id: "old",
      messages: [
        { role: "assistant", text: "Have a look at this." },
        {
          role: "assistant",
          text: "Filed — I'll make sure it gets looked at.",
          issue: {
            number: 7,
            url: "https://github.test/issues/7",
            title: DRAFT.title,
          },
        },
      ],
      turnsRemaining: 30,
      draft: null,
    });

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();

    // The card shows what she needs to judge it by, and asks.
    expect(await screen.findByText(DRAFT.title)).toBeInTheDocument();
    expect(screen.getByText(DRAFT.summary)).toBeInTheDocument();
    expect(screen.getByText(/Shall I write this down/)).toBeInTheDocument();
    // Including what of it becomes public, before she agrees to it (#888).
    expect(screen.getByText(PUBLIC_ISSUE_NOTE)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "File this issue" }),
    );

    expect(service.fileIssue).toHaveBeenCalledWith("old", getToken);
    // One warm line and a quiet link, and the question is gone.
    expect(await screen.findByText(/^Filed/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "See what I wrote down" }),
    ).toHaveAttribute("href", "https://github.test/issues/7");
    expect(screen.queryByText(DRAFT.title)).not.toBeInTheDocument();
  });

  it("lets her say not now", async () => {
    filing();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });
    service.dismissDraft.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: null,
    });

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();
    await screen.findByText(DRAFT.title);

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(service.dismissDraft).toHaveBeenCalledWith("old", getToken);
    expect(service.fileIssue).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(DRAFT.title)).not.toBeInTheDocument(),
    );
  });

  it("says so when filing did not land, and keeps the card", async () => {
    filing();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });
    service.fileIssue.mockRejectedValue(new HttpError("no", 503));

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();
    await screen.findByText(DRAFT.title);
    await userEvent.click(
      screen.getByRole("button", { name: "File this issue" }),
    );

    expect(
      await screen.findByText(/it's still here, so you can try again/),
    ).toBeInTheDocument();
    // Still there to press again, which is what the message promises.
    expect(
      screen.getByRole("button", { name: "File this issue" }),
    ).toBeEnabled();
  });

  it("rests the card's buttons while a reply is on its way", async () => {
    // A reply can take most of three minutes, and the card sits there the
    // whole time. Deciding mid-reply asked the server two things about one
    // conversation at once — which is how filing once came back as filing
    // twice — and the answer she gave could be an answer to a card the
    // reply was about to rewrite. So the buttons wait for it.
    filing();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });
    let reply: (session: unknown) => void = () => {};
    service.sendMessage.mockReturnValue(
      new Promise((resolve) => {
        reply = resolve;
      }),
    );

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();
    await screen.findByText(DRAFT.title);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Your message" }),
      "And the fonts look odd",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thinking…");

    // The card is still there — waiting, not gone — and cannot be answered.
    expect(screen.getByText(DRAFT.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "File this issue" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();

    // Once the reply lands they come back.
    await act(async () => {
      reply({
        id: "old",
        messages: [{ role: "assistant", text: "Alright." }],
        turnsRemaining: 29,
        draft: DRAFT,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "File this issue" }),
      ).toBeEnabled(),
    );
    expect(service.fileIssue).not.toHaveBeenCalled();
  });

  it("offers only to let the card go where filing is switched off", async () => {
    // A host with an API key and no GitHub token, holding a draft written
    // before the token went away.
    available();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [{ role: "assistant", text: "Have a look at this." }],
      turnsRemaining: 30,
      draft: DRAFT,
    });

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();

    expect(await screen.findByText(DRAFT.title)).toBeInTheDocument();
    // No button that cannot work — and the one thing to do is said plainly.
    expect(
      screen.queryByRole("button", { name: "File this issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/I can't write things down just yet/),
    ).toBeInTheDocument();
    // And no promise about what filing would publish, since nothing can be
    // filed from here.
    expect(screen.queryByText(PUBLIC_ISSUE_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
  });

  it("keeps the line breaks in a step-by-step answer", async () => {
    available();
    service.getSession.mockResolvedValue({
      id: "old",
      messages: [
        { role: "assistant", text: "First, open Haiku.\n\nThen press Add." },
      ],
      turnsRemaining: 30,
    });

    renderWidget({ storage: fakeStorage({ [SESSION_STORAGE_KEY]: "old" }) });
    await openPanel();

    // Rendered as separate lines rather than run together into one
    // paragraph, so instructions still read as steps.
    expect(await screen.findByText("First, open Haiku.")).toBeInTheDocument();
    expect(screen.getByText("Then press Add.")).toBeInTheDocument();
  });
});
