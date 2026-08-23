import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { AdminHaigaPage } from "./admin-haiga-page";
import { Haiga } from "../../../models";
import { HaigaService } from "../../../services/haiga";
import { TokenGetter } from "../../../services/http";
import { ImageService } from "../../../services/images";
import { answerYes, renderAdminPage } from "../admin-ui-test-helpers";

function renderPage(initialEntry?: string) {
  return renderAdminPage(<AdminHaigaPage />, "/admin/haiga/:id?", initialEntry);
}

vi.mock("../../../services/haiga", () => ({
  HaigaService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
  },
}));

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// The saved haiga as it exists in the published list before the edit.
let savedHaiga: Haiga;

// Renders the page, opens the only haiga in the editor, and picks a
// replacement image file — the state right before the user hits save.
async function openEditorAndPickImage() {
  const { container, adminUi } = renderPage();
  const notify = adminUi.notify;
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  // Opening the editor is a navigation now; wait for it to render.
  await screen.findByRole("button", { name: "Save" });
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { notify };
}

describe("AdminHaigaPage image replacement", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([savedHaiga]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
    vi.mocked(ImageService.upload).mockResolvedValue("new.png");
    // PhotoPicker needs an object URL for the preview of the freshly picked
    // file; spy on the setup.ts polyfill so restoreAllMocks undoes this.
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps the old image when saving the list fails", async () => {
    vi.mocked(HaigaService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify } = await openEditorAndPickImage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // The replacement was uploaded before the list save was attempted.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0],
    );
    // The published list entry is untouched.
    expect(savedHaiga.image).toBe("old.png");
  });

  it("treats an empty upload result as a failed upload", async () => {
    vi.mocked(ImageService.upload).mockResolvedValue("");
    const { notify } = await openEditorAndPickImage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save haiga image",
        "error",
      ),
    );
    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(savedHaiga.image).toBe("old.png");
  });

  it("keeps the old image and skips the list save when the upload fails", async () => {
    vi.mocked(ImageService.upload).mockRejectedValue(
      new Error("upload failed"),
    );
    const { notify } = await openEditorAndPickImage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save haiga image",
        "error",
      ),
    );
    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(savedHaiga.image).toBe("old.png");
  });

  it("saves the new image and leaves the replaced object in storage", async () => {
    const { notify } = await openEditorAndPickImage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Haiga saved"));
    // Saved list references the new upload, uploaded before the list save.
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [{ ...savedHaiga, image: "new.png" }],
      expect.any(Function),
    );
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0],
    );
    // The replaced image object is left for the cleanup sweep — it may
    // still be referenced elsewhere (e.g. as the site background).
    // The list entry itself was replaced, never mutated in place.
    expect(savedHaiga.image).toBe("old.png");
  });
});

describe("AdminHaigaPage deletion", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([savedHaiga]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // Renders the page, clicks the delete control of the only haiga, and
  // confirms the deletion dialog.
  async function confirmDelete() {
    const { adminUi } = renderPage();
    const notify = adminUi.notify;
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await answerYes(adminUi);
    return { notify };
  }

  it("keeps the list intact when saving the shortened list fails", async () => {
    vi.mocked(HaigaService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
  });

  it("saves the shortened list and leaves the image object in storage", async () => {
    const { notify } = await confirmDelete();

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Haiga deleted"));
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [],
      expect.any(Function),
    );
    // The image object is left for the cleanup sweep — it may still be
    // referenced elsewhere (e.g. as the site background).
  });
});

describe("AdminHaigaPage creation", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([savedHaiga]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // Renders the page and clicks the add-item control, so the creation
  // dialog has been handed to confirm().
  async function openCreateConfirmation() {
    const { adminUi } = renderPage();
    const notify = adminUi.notify;
    // Wait for the list to load so the saved list is deterministic.
    await screen.findByRole("button", { name: "Edit" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    return { notify, adminUi };
  }

  it("creates an empty haiga and opens it in the editor on Yes", async () => {
    const { notify, adminUi } = await openCreateConfirmation();
    await answerYes(adminUi);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("New haiga created"),
    );
    // The saved list is the existing haiga plus a fresh empty one.
    const [savedList] = vi.mocked(HaigaService.updateList).mock.calls[0] as [
      Array<Haiga>,
      TokenGetter,
    ];
    expect(savedList).toHaveLength(2);
    expect(savedList[0]).toEqual(savedHaiga);
    expect(savedList[1]).toMatchObject({
      lines: [],
      publisher: "",
      image: "",
    });
    expect(savedList[1].id).not.toBe("");
    // The new haiga is open in the editor.
    await screen.findByRole("button", { name: "Save" });
  });

  it("does nothing until the confirmation is answered", async () => {
    const { notify, adminUi } = await openCreateConfirmation();

    // The page only hands the dialog to confirm(); nothing is created
    // unless the provider runs the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new empty haiga"),
      expect.any(Function),
    );
    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("stays on the list when saving the new haiga fails", async () => {
    vi.mocked(HaigaService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify, adminUi } = await openCreateConfirmation();
    await answerYes(adminUi);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // The editor must not open for a haiga that was never persisted.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("AdminHaigaPage list reordering", () => {
  let secondHaiga: Haiga;

  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    secondHaiga = {
      id: "h2",
      lines: [],
      publisher: "kari",
      image: "second.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([
      savedHaiga,
      secondHaiga,
    ]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
  });

  async function renderList() {
    const { adminUi } = renderPage();
    const notify = adminUi.notify;
    await screen.findAllByRole("button", { name: "Edit" });
    return { notify };
  }

  it("saves the reordered list on move down", async () => {
    const { notify } = await renderList();
    // Only the first item has a move-down control.
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [secondHaiga, savedHaiga],
      expect.any(Function),
    );
  });

  it("saves the reordered list on move up", async () => {
    const { notify } = await renderList();
    // Only the second item has a move-up control.
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [secondHaiga, savedHaiga],
      expect.any(Function),
    );
  });
});

describe("AdminHaigaPage search", () => {
  beforeEach(() => {
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([
      {
        id: "h1",
        lines: ["old pond", "a frog"],
        publisher: "kari",
        image: "a.png",
      },
      { id: "h2", lines: ["summer grass"], publisher: "other", image: "b.png" },
    ]);
  });

  it("filters by joined lines and publisher", async () => {
    renderPage();
    const search = await screen.findByRole("searchbox", {
      name: "Search haiga",
    });
    // Compact haiga rows only show the publisher (the lines live in the
    // image), but the lines are still searchable.
    fireEvent.change(search, { target: { value: "pond a frog" } });
    expect(screen.getByText("kari")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
    fireEvent.change(search, { target: { value: "OTHER" } });
    expect(screen.queryByText("kari")).toBeNull();
    expect(screen.getByText("other")).toBeInTheDocument();
  });
});

describe("AdminHaigaPage load failure", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows a retryable error instead of an empty editable list", async () => {
    vi.mocked(HaigaService.getListFromApi)
      .mockRejectedValueOnce(new Error("GET failed"))
      .mockResolvedValue([savedHaiga]);
    renderPage();

    await screen.findByText("Failed to load haiga.");
    // No editable list — saving one would overwrite the real data.
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();

    // Retry reloads and shows the list.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Edit" });
  });
});

describe("AdminHaigaPage routing", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([savedHaiga]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:preview");
  });

  it("opens the editor at /admin/haiga/:id when editing", async () => {
    const { router } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save" });

    expect(router.state.location.pathname).toBe("/admin/haiga/h1");
  });

  it("opens the editor directly from an editor URL", async () => {
    renderPage("/admin/haiga/h1");

    expect(
      await screen.findByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
  });

  it("falls back to the list for an unknown editor URL", async () => {
    const { router } = renderPage("/admin/haiga/no-such-id");

    expect(
      await screen.findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/haiga"),
    );
  });

  it("returns to the list on browser back", async () => {
    const { router } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save" });

    await act(async () => {
      router.navigate(-1);
    });

    expect(
      await screen.findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
  });

  it("keeps the search filter through the editor round trip", async () => {
    const { router } = renderPage("/admin/haiga?q=kari");

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Back on the list she was looking at, filter and all.
    expect(
      await screen.findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe("?q=kari");
  });

  it("treats a freshly picked image as unsaved changes on Close", async () => {
    const { container, adminUi } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save" });
    fireEvent.change(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: {
          files: [new File(["img"], "next.png", { type: "image/png" })],
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("closes to the list without confirmation while clean", async () => {
    const { adminUi, router } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(
      await screen.findByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/haiga");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });
});
