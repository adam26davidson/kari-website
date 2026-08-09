import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import AdminHaikuPage from "./adminHaikuPage";
import { Haiku } from "../../../Models";
import { HaikuService } from "../../../services/haiku";
import { answerYes, renderWithAdminUi } from "../admin-ui-test-helpers";

vi.mock("../../../services/haiku", () => ({
  HaikuService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

// Deterministic id for haiku created through the "new item" flow.
vi.mock("uuid", () => ({ v4: () => "new-id" }));

// The saved haiku as they exist in the published list before any edit.
let first: Haiku;
let second: Haiku;

function renderPage() {
  return renderWithAdminUi(<AdminHaikuPage />).adminUi;
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
    const adminUi = renderPage();

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
      screen.queryByRole("button", { name: "Add item" }),
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
    const adminUi = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));

    await answerYes(adminUi);

    expect(HaikuService.updateList).toHaveBeenCalledWith(
      [first, second, { lines: [], publisher: "", id: "new-id" }],
      expect.any(Function),
    );
    expect(adminUi.notify).toHaveBeenCalledWith("New haiku created");
    // The editor opened on the new haiku, whose empty lines are invalid,
    // so save is disabled.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does nothing until the confirmation is answered", async () => {
    const adminUi = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));

    // The page only hands the dialog to confirm(); nothing is created
    // unless the provider runs the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new empty haiku"),
      expect.any(Function),
    );
    expect(HaikuService.updateList).not.toHaveBeenCalled();
    // Still on the list view, not in the editor.
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });

  it("does not open the editor when the save fails", async () => {
    vi.mocked(HaikuService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const adminUi = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));

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
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });
});

describe("AdminHaikuPage deletion", () => {
  it("removes the confirmed haiku and saves the shortened list", async () => {
    const adminUi = renderPage();
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
    const adminUi = renderPage();
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
    const adminUi = renderPage();
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

describe("AdminHaikuPage editing", () => {
  it("edits a copy and saves it back into the list by id", async () => {
    const adminUi = renderPage();
    const edits = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);

    const textarea = screen.getByPlaceholderText(/line 1/);
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
    const edits = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);

    fireEvent.change(screen.getByPlaceholderText(/line 1/), {
      target: { value: "" },
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("skips the save when the open haiku left the list", async () => {
    const adminUi = renderPage();
    // Queue up a deletion of the first haiku, then open it in the editor
    // before confirming — the stale confirmation removes it underneath
    // the open editor.
    const deletes = await screen.findAllByRole("button", { name: "Delete" });
    fireEvent.click(deletes[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
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
