import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AdminPhotographyPage } from "./admin-photography-page";
import { PhotographyPost } from "../../../Models";
import { PhotographyService } from "../../../services/photography";
import { ImageService } from "../../../services/images";

vi.mock("../../../services/photography", () => ({
  PhotographyService: {
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

function iconButton(container: HTMLElement, icon: string): HTMLElement {
  const button = container
    .querySelector(`svg[data-icon="${icon}"]`)
    ?.closest(".admin-icon-button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

// The saved post as it exists in the published list before the edit.
let savedPost: PhotographyPost;

async function renderPage() {
  const notify = vi.fn();
  const setConfirmation = vi.fn();
  const { container } = render(
    <AdminPhotographyPage
      setLoading={vi.fn()}
      setConfirmation={setConfirmation}
      notify={notify}
    />,
  );
  await waitFor(() => iconButton(container, "pencil"));
  return { container, notify, setConfirmation };
}

// Renders the page, opens the only post in the editor, and picks a
// replacement file for its image — the state right before the user hits
// save.
async function openEditorAndReplaceImage() {
  const { container, notify } = await renderPage();
  fireEvent.click(iconButton(container, "pencil"));
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { container, notify };
}

beforeEach(() => {
  savedPost = new PhotographyPost();
  savedPost.id = "p1";
  savedPost.title = "A Post";
  savedPost.images = [{ image: "old.png", blurb: "a photo" }];
  vi.mocked(PhotographyService.getListFromApi).mockResolvedValue([savedPost]);
  vi.mocked(PhotographyService.updateList).mockResolvedValue(undefined);
  vi.mocked(ImageService.upload).mockResolvedValue("new.png");
  vi.mocked(ImageService.delete).mockResolvedValue(undefined);
  // The central polyfill in test/setup.ts provides createObjectURL; spy on
  // it (auto-restored between tests) so PhotoPicker gets a stable preview
  // URL for the freshly picked file.
  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminPhotographyPage image replacement", () => {
  it("keeps the old image when saving the list fails", async () => {
    vi.mocked(PhotographyService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

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
      vi.mocked(PhotographyService.updateList).mock.invocationCallOrder[0],
    );
    // The published list entry is untouched.
    expect(savedPost.images).toEqual([{ image: "old.png", blurb: "a photo" }]);
  });

  it("treats an empty upload result as a failed upload", async () => {
    vi.mocked(ImageService.upload).mockResolvedValue("");
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save photography post images",
        "error",
      ),
    );
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(savedPost.images).toEqual([{ image: "old.png", blurb: "a photo" }]);
  });

  it("keeps the old image and skips the list save when the upload fails", async () => {
    vi.mocked(ImageService.upload).mockRejectedValue(
      new Error("upload failed"),
    );
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save photography post images",
        "error",
      ),
    );
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(savedPost.images).toEqual([{ image: "old.png", blurb: "a photo" }]);
  });

  it("deletes the old image only after the save succeeds", async () => {
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post saved"),
    );
    // Saved list references the new upload and keeps the blurb.
    const [savedList] = vi.mocked(PhotographyService.updateList).mock
      .calls[0] as [Array<PhotographyPost>, () => Promise<string>];
    expect(savedList[0].images).toEqual([
      { image: "new.png", blurb: "a photo" },
    ]);
    // Old image deleted exactly once, and only after upload + list save.
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    const uploadOrder = vi.mocked(ImageService.upload).mock
      .invocationCallOrder[0];
    const saveOrder = vi.mocked(PhotographyService.updateList).mock
      .invocationCallOrder[0];
    const deleteOrder = vi.mocked(ImageService.delete).mock
      .invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(deleteOrder);
    // The published list entry itself was replaced, never mutated in place.
    expect(savedPost.images).toEqual([{ image: "old.png", blurb: "a photo" }]);
  });
});

describe("AdminPhotographyPage reordering in the editor", () => {
  it("keeps a pending file with its image through a reorder and save", async () => {
    savedPost.images = [
      { image: "old1.png", blurb: "first" },
      { image: "old2.png", blurb: "second" },
    ];
    vi.mocked(PhotographyService.getListFromApi).mockResolvedValue([savedPost]);
    const { container, notify } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));

    // Replace the first image with a not-yet-uploaded file...
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["img"], "next.png", { type: "image/png" })],
      },
    });
    // ...then move that item down. The first list item has no move-up
    // control, so the first arrow-down on the page is item 0's.
    fireEvent.click(iconButton(container, "arrow-down"));

    fireEvent.click(iconButton(container, "floppy-disk"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post saved"),
    );

    // The pending file traveled with its entry: exactly one upload, and the
    // saved list has the untouched image first and the fresh upload (with
    // its blurb) second.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    const [savedList] = vi.mocked(PhotographyService.updateList).mock
      .calls[0] as [Array<PhotographyPost>, () => Promise<string>];
    expect(savedList[0].images).toEqual([
      { image: "old2.png", blurb: "second" },
      { image: "new.png", blurb: "first" },
    ]);
    // Only the replaced image is deleted, and only after the list save.
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old1.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    const uploadOrder = vi.mocked(ImageService.upload).mock
      .invocationCallOrder[0];
    const saveOrder = vi.mocked(PhotographyService.updateList).mock
      .invocationCallOrder[0];
    const deleteOrder = vi.mocked(ImageService.delete).mock
      .invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(deleteOrder);
  });
});

describe("AdminPhotographyPage deletion", () => {
  // Renders the page, clicks the delete control of the only post, and
  // confirms the deletion dialog.
  async function confirmDelete() {
    const { container, notify, setConfirmation } = await renderPage();
    fireEvent.click(iconButton(container, "trash"));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      options: Array<{ label: string; callback: () => void }>;
    };
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });
    return { notify };
  }

  it("keeps the images when saving the shortened list fails", async () => {
    vi.mocked(PhotographyService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // Still-referenced images must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
  });

  it("deletes the post images only after the shortened list is saved", async () => {
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post deleted"),
    );
    expect(PhotographyService.updateList).toHaveBeenCalledWith(
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
      vi.mocked(PhotographyService.updateList).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(ImageService.delete).mock.invocationCallOrder[0]);
  });
});

describe("AdminPhotographyPage creation", () => {
  // Renders the page and clicks the add-item control, returning the
  // confirmation dialog handed to setConfirmation.
  async function openCreateConfirmation() {
    const { container, notify, setConfirmation } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      options: Array<{ label: string; callback: () => void }>;
    };
    return { container, notify, confirmation };
  }

  it("creates an empty post and opens it in the editor on Yes", async () => {
    const { notify, confirmation } = await openCreateConfirmation();
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("New photography post created"),
    );
    // The saved list is the existing post plus a fresh empty one.
    const [savedList] = vi.mocked(PhotographyService.updateList).mock
      .calls[0] as [Array<PhotographyPost>, () => Promise<string>];
    expect(savedList).toHaveLength(2);
    expect(savedList[0]).toEqual(savedPost);
    expect(savedList[1]).toMatchObject({
      title: "",
      subtitle: "",
      blurb: "",
      images: [],
    });
    expect(savedList[1].id).not.toBe("");
    // The new post is open in the editor.
    await screen.findByLabelText("Title");
  });

  it("does nothing on No", async () => {
    const { notify, confirmation } = await openCreateConfirmation();
    const no = confirmation.options.find((o) => o.label === "No");
    await act(async () => {
      no?.callback();
    });

    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("stays on the list when saving the new post fails", async () => {
    vi.mocked(PhotographyService.updateList).mockRejectedValue(
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
    // The editor must not open for a post that was never persisted.
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});

describe("AdminPhotographyPage list reordering", () => {
  let secondPost: PhotographyPost;

  beforeEach(() => {
    secondPost = new PhotographyPost();
    secondPost.id = "p2";
    secondPost.title = "B Post";
    vi.mocked(PhotographyService.getListFromApi).mockResolvedValue([
      savedPost,
      secondPost,
    ]);
  });

  it("saves the reordered list on move down", async () => {
    const { notify } = await renderPage();
    // Only the first item has a move-down control.
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(PhotographyService.updateList).toHaveBeenCalledWith(
      [secondPost, savedPost],
      expect.any(Function),
    );
  });

  it("saves the reordered list on move up", async () => {
    const { notify } = await renderPage();
    // Only the second item has a move-up control.
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(PhotographyService.updateList).toHaveBeenCalledWith(
      [secondPost, savedPost],
      expect.any(Function),
    );
  });
});

describe("AdminPhotographyPage load failure", () => {
  it("shows a retryable error instead of an empty editable list", async () => {
    vi.mocked(PhotographyService.getListFromApi).mockRejectedValueOnce(
      new Error("GET failed"),
    );
    const { container } = render(
      <AdminPhotographyPage
        setLoading={vi.fn()}
        setConfirmation={vi.fn()}
        notify={vi.fn()}
      />,
    );

    await screen.findByText("Failed to load photography posts.");
    // No editable list — saving one would overwrite the real data.
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();

    // Retry reloads and shows the list.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => iconButton(container, "pencil"));
  });
});

describe("AdminPhotographyPage closing the editor", () => {
  it("abandons the open post without saving", async () => {
    const { container } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByLabelText("Title");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    // Back on the list view.
    iconButton(container, "pencil");
  });
});
