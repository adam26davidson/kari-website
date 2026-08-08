import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import AdminHaigaPage from "./adminHaigaPage";
import { Haiga } from "../../../Models";
import { HaigaService } from "../../../services/haiga";
import { ImageService } from "../../../services/images";

vi.mock("../../../services/haiga", () => ({
  HaigaService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
  },
}));

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

// The saved haiga as it exists in the published list before the edit.
let savedHaiga: Haiga;

// Renders the page, opens the only haiga in the editor, and picks a
// replacement image file — the state right before the user hits save.
async function openEditorAndPickImage() {
  const notify = vi.fn();
  const { container } = render(
    <AdminHaigaPage
      setLoading={vi.fn()}
      setConfirmation={vi.fn()}
      notify={notify}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
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
    vi.mocked(ImageService.delete).mockResolvedValue(undefined);
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
    // The still-referenced image must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
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
    expect(ImageService.delete).not.toHaveBeenCalled();
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
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(savedHaiga.image).toBe("old.png");
  });

  it("deletes the old image only after the save succeeds", async () => {
    const { notify } = await openEditorAndPickImage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Haiga saved"));
    // Saved list references the new upload.
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [{ ...savedHaiga, image: "new.png" }],
      expect.any(Function),
    );
    // Old image deleted exactly once, and only after upload + list save.
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    const uploadOrder =
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0];
    const saveOrder =
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(deleteOrder);
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
    vi.mocked(ImageService.delete).mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // Renders the page, clicks the delete control of the only haiga, and
  // confirms the deletion dialog.
  async function confirmDelete() {
    const notify = vi.fn();
    const setConfirmation = vi.fn();
    render(
      <AdminHaigaPage
        setLoading={vi.fn()}
        setConfirmation={setConfirmation}
        notify={notify}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      options: Array<{ label: string; callback: () => void }>;
    };
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });
    return { notify };
  }

  it("keeps the image when saving the shortened list fails", async () => {
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
    // The still-referenced image must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
  });

  it("deletes the image only after the shortened list is saved", async () => {
    const { notify } = await confirmDelete();

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Haiga deleted"));
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [],
      expect.any(Function),
    );
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    // List save strictly before the image delete.
    expect(
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(ImageService.delete).mock.invocationCallOrder[0]);
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

  // Renders the page and clicks the add-item control, returning the
  // confirmation dialog handed to setConfirmation.
  async function openCreateConfirmation() {
    const notify = vi.fn();
    const setConfirmation = vi.fn();
    render(
      <AdminHaigaPage
        setLoading={vi.fn()}
        setConfirmation={setConfirmation}
        notify={notify}
      />,
    );
    // Wait for the list to load so the saved list is deterministic.
    await screen.findByRole("button", { name: "Edit" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      options: Array<{ label: string; callback: () => void }>;
    };
    return { notify, confirmation };
  }

  it("creates an empty haiga and opens it in the editor on Yes", async () => {
    const { notify, confirmation } = await openCreateConfirmation();
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("New haiga created"),
    );
    // The saved list is the existing haiga plus a fresh empty one.
    const [savedList] = vi.mocked(HaigaService.updateList).mock.calls[0] as [
      Array<Haiga>,
      () => Promise<string>,
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

  it("does nothing on No", async () => {
    const { notify, confirmation } = await openCreateConfirmation();
    const no = confirmation.options.find((o) => o.label === "No");
    await act(async () => {
      no?.callback();
    });

    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("stays on the list when saving the new haiga fails", async () => {
    vi.mocked(HaigaService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify, confirmation } = await openCreateConfirmation();
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });

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
    const notify = vi.fn();
    render(
      <AdminHaigaPage
        setLoading={vi.fn()}
        setConfirmation={vi.fn()}
        notify={notify}
      />,
    );
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
    render(
      <AdminHaigaPage
        setLoading={vi.fn()}
        setConfirmation={vi.fn()}
        notify={vi.fn()}
      />,
    );

    await screen.findByText("Failed to load haiga.");
    // No editable list — saving one would overwrite the real data.
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();

    // Retry reloads and shows the list.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Edit" });
  });
});
