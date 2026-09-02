import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AdminHaikuPage } from "./admin-haiku-page";
import { Haiku } from "@kari/shared/models";
import { HaikuService } from "@kari/shared/services/haiku";
import {
  answerNo,
  answerYes,
  navigateInTest,
  renderAdminPage,
} from "../admin-ui-test-helpers";

vi.mock("@kari/shared/services/haiku", () => ({
  HaikuService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
  },
}));

vi.mock("../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// Deterministic id for haiku created through the "new item" flow.
vi.mock("uuid", () => ({ v4: () => "new-id" }));

// The saved haiku as they exist in the published list before any edit.
let first: Haiku;
let second: Haiku;

function renderPage(initialEntry?: string) {
  return renderAdminPage(<AdminHaikuPage />, "/haiku/:id?", initialEntry);
}

/** Opens the first haiku's editor from the list and waits for it. */
async function openFirstHaiku() {
  const edits = await screen.findAllByRole("button", { name: "Edit" });
  fireEvent.click(edits[0]);
  return await screen.findByPlaceholderText(/line 1/);
}

beforeEach(() => {
  first = {
    id: "h1",
    lines: ["old pond", "a frog jumps in", "splash"],
    publisher: "pub-one",
  };
  second = { id: "h2", lines: ["summer grass"], publisher: "pub-two" };
  vi.mocked(HaikuService.getListFromApi).mockResolvedValue([first, second]);
  vi.mocked(HaikuService.updateList).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminHaikuPage loading", () => {
  it("renders the loaded haiku list", async () => {
    const { adminUi } = renderPage();

    expect(await screen.findByText("old pond")).toBeInTheDocument();
    expect(screen.getByText("a frog jumps in")).toBeInTheDocument();
    expect(screen.getByText("pub-one")).toBeInTheDocument();
    expect(screen.getByText("summer grass")).toBeInTheDocument();
    expect(screen.getByText("pub-two")).toBeInTheDocument();
    // Loading indicator turned on before the fetch and off after it.
    expect(adminUi.showLoading).toHaveBeenNthCalledWith(1, "Loading haiku...");
    expect(adminUi.hideLoading).toHaveBeenCalled();
  });

  it("shows the load error instead of an empty editable list", async () => {
    vi.mocked(HaikuService.getListFromApi).mockRejectedValue(
      new Error("GET failed"),
    );
    renderPage();

    expect(
      await screen.findByText("Failed to load haiku."),
    ).toBeInTheDocument();
    // No editable (and saveable) empty list — saving it would overwrite
    // the real data.
    expect(
      screen.queryByRole("button", { name: "Add a haiku" }),
    ).not.toBeInTheDocument();
  });

  it("retries the load from the error state", async () => {
    vi.mocked(HaikuService.getListFromApi).mockRejectedValueOnce(
      new Error("GET failed"),
    );
    renderPage();
    await screen.findByText("Failed to load haiku.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("old pond")).toBeInTheDocument();
    expect(HaikuService.getListFromApi).toHaveBeenCalledTimes(2);
  });
});

describe("AdminHaikuPage new haiku", () => {
  it("creates and opens a new empty haiku on Yes", async () => {
    const { adminUi } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a haiku" }));

    await answerYes(adminUi);

    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [first, second, { lines: [], publisher: "", id: "new-id" }],
      expect.any(Function),
    );
    expect(adminUi.notify).toHaveBeenCalledWith("New haiku created");
    // The editor opened on the new haiku, whose empty lines are invalid,
    // so save is disabled.
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does nothing until the confirmation is answered", async () => {
    const { adminUi } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a haiku" }));

    // The page only hands the dialog to confirm(); nothing is created
    // unless the provider runs the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new empty haiku"),
      expect.any(Function),
    );
    expect(HaikuService.updateList).not.toHaveBeenCalled();
    // Still on the list view, not in the editor.
    expect(
      screen.getByRole("button", { name: "Add a haiku" }),
    ).toBeInTheDocument();
  });

  it("does not open the editor when the save fails", async () => {
    vi.mocked(HaikuService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { adminUi } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a haiku" }));

    await answerYes(adminUi);

    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add a haiku" }),
    ).toBeInTheDocument();
  });
});

describe("AdminHaikuPage deletion", () => {
  it("removes the confirmed haiku and saves the shortened list", async () => {
    const { adminUi } = renderPage();
    const deletes = await screen.findAllByRole("button", { name: "Delete" });
    fireEvent.click(deletes[0]);

    await answerYes(adminUi);

    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [second],
      expect.any(Function),
    );
    expect(adminUi.notify).toHaveBeenCalledWith("Haiku deleted");
  });
});

describe("AdminHaikuPage reordering", () => {
  it("moves an item down and saves the new order", async () => {
    const { adminUi } = renderPage();
    // Only the first item has a "Move down" control.
    fireEvent.click(await screen.findByRole("button", { name: "Move down" }));

    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith("Order updated"),
    );
    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [second, first],
      expect.any(Function),
    );
  });

  it("moves an item up and saves the new order", async () => {
    const { adminUi } = renderPage();
    // Only the second item has a "Move up" control.
    fireEvent.click(await screen.findByRole("button", { name: "Move up" }));

    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith("Order updated"),
    );
    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [second, first],
      expect.any(Function),
    );
  });
});

describe("AdminHaikuPage search", () => {
  it("matches across line breaks and the publisher, acting by id", async () => {
    const { adminUi } = renderPage();
    const search = await screen.findByRole("searchbox", {
      name: "Search haiku",
    });

    // A phrase spanning the first two lines still matches.
    fireEvent.change(search, { target: { value: "pond a frog" } });
    expect(screen.getByText("old pond")).toBeInTheDocument();
    expect(screen.queryByText("summer grass")).toBeNull();
    // Reordering is meaningless in a partial view.
    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();

    fireEvent.change(search, { target: { value: "PUB-TWO" } });
    expect(screen.queryByText("old pond")).toBeNull();
    expect(screen.getByText("summer grass")).toBeInTheDocument();

    // The only visible delete control must remove the matched haiku, not
    // whatever sits at that position in the full list.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await answerYes(adminUi);
    await waitFor(() =>
      expect(HaikuService.updateList).toHaveBeenCalledWith(
        [first],
        expect.any(Function),
      ),
    );

    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.getByText('No haiku match "nothing"')).toBeInTheDocument();
  });
});

describe("AdminHaikuPage editing", () => {
  it("edits a copy and saves it back into the list by id", async () => {
    const { adminUi } = renderPage();
    const textarea = await openFirstHaiku();
    expect(textarea).toHaveValue("old pond\na frog jumps in\nsplash");
    fireEvent.change(textarea, {
      target: { value: "new pond\nstill water" },
    });
    // The editor works on a copy: the list entry is untouched until save.
    expect(first.lines).toEqual(["old pond", "a frog jumps in", "splash"]);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith("Haiku saved"),
    );
    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [
        { id: "h1", lines: ["new pond", "still water"], publisher: "pub-one" },
        second,
      ],
      expect.any(Function),
    );
  });

  it("disables save when the first line is empty", async () => {
    renderPage();
    const textarea = await openFirstHaiku();

    fireEvent.change(textarea, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("skips the save when the open haiku left the list", async () => {
    const { adminUi } = renderPage();
    // Queue up a deletion of the first haiku, then open it in the editor
    // before confirming — the stale confirmation removes it underneath
    // the open editor.
    const deletes = await screen.findAllByRole("button", { name: "Delete" });
    fireEvent.click(deletes[0]);
    await openFirstHaiku();
    await answerYes(adminUi);
    expect(HaikuService.updateList).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The id-not-found guard bails out without saving.
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith("Haiku not found"),
    );
    expect(HaikuService.updateList).toHaveBeenCalledTimes(1);
    expect(adminUi.notify).not.toHaveBeenCalledWith("Haiku saved");
  });
});

describe("AdminHaikuPage routing", () => {
  it("opens the editor at /admin/haiku/:id when editing", async () => {
    const { router } = renderPage();

    await openFirstHaiku();

    expect(router.state.location.pathname).toBe("/haiku/h1");
  });

  it("opens the editor directly from an editor URL", async () => {
    renderPage("/haiku/h2");

    expect(await screen.findByPlaceholderText(/line 1/)).toHaveValue(
      "summer grass",
    );
  });

  it("falls back to the list for an unknown editor URL", async () => {
    const { router } = renderPage("/haiku/no-such-id");

    expect(await screen.findByText("old pond")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/haiku"));
  });

  it("returns to the list on browser back", async () => {
    const { router } = renderPage();
    await openFirstHaiku();

    await navigateInTest(router, -1);

    expect(await screen.findByText("summer grass")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/line 1/)).toBeNull();
  });

  it("closes to the list without confirmation while clean", async () => {
    const { adminUi, router } = renderPage();
    await openFirstHaiku();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText("summer grass")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("keeps the search filter through the editor round trip", async () => {
    const { router } = renderPage("/haiku?q=frog");
    expect(await screen.findByText("old pond")).toBeInTheDocument();
    expect(screen.queryByText("summer grass")).toBeNull();

    await openFirstHaiku();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Back on the list, still filtered to what she was looking at.
    expect(await screen.findByText("old pond")).toBeInTheDocument();
    expect(screen.queryByText("summer grass")).toBeNull();
    expect(router.state.location.search).toBe("?q=frog");
  });

  it("asks before discarding unsaved edits and stays on No", async () => {
    const { adminUi } = renderPage();
    const textarea = await openFirstHaiku();
    fireEvent.change(textarea, { target: { value: "changed line" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(screen.getByPlaceholderText(/line 1/)).toBeInTheDocument();
  });

  it("discards unsaved edits and leaves on Yes", async () => {
    const { adminUi } = renderPage();
    const textarea = await openFirstHaiku();
    fireEvent.change(textarea, { target: { value: "changed line" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await answerYes(adminUi);

    // Back on the list with the original, unedited haiku.
    expect(await screen.findByText("old pond")).toBeInTheDocument();
    expect(HaikuService.updateList).not.toHaveBeenCalled();
  });

  it("does not block leaving after the edits were saved", async () => {
    const { adminUi } = renderPage();
    const textarea = await openFirstHaiku();
    fireEvent.change(textarea, { target: { value: "changed line" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith("Haiku saved"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText("changed line")).toBeInTheDocument();
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });
});
