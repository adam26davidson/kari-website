import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { AdminPhotographyPage } from "./admin-photography-page";
import { PhotographyPost } from "../../../models";
import { PhotographyService } from "../../../services/photography";
import { TokenGetter } from "../../../services/http";
import { ImageService } from "../../../services/images";
import { answerYes, renderAdminPage } from "../admin-ui-test-helpers";

vi.mock("../../../services/photography", () => ({
  PhotographyService: {
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

async function renderPage(initialEntry?: string) {
  const { container, adminUi, router } = renderAdminPage(
    <AdminPhotographyPage />,
    "/admin/photography/:id?",
    initialEntry,
  );
  const notify = adminUi.notify;
  await waitFor(() => iconButton(container, "pencil"));
  return { container, notify, adminUi, router };
}

// Renders the page, opens the only post in the editor, and picks a
// replacement file for its image — the state right before the user hits
// save.
async function openEditorAndReplaceImage() {
  const { container, notify } = await renderPage();
  fireEvent.click(iconButton(container, "pencil"));
  // Opening the editor is a navigation now; wait for it to render.
  await screen.findByLabelText("Title");
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { container, notify };
}

beforeEach(() => {
  savedPost = {
    id: "p1",
    title: "A Post",
    subtitle: "",
    blurb: "",
    images: [{ image: "old.png", blurb: "a photo" }],
  };
  vi.mocked(PhotographyService.getListFromApi).mockResolvedValue([savedPost]);
  vi.mocked(PhotographyService.updateList).mockResolvedValue(undefined);
  vi.mocked(ImageService.upload).mockResolvedValue("new.png");
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
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(savedPost.images).toEqual([{ image: "old.png", blurb: "a photo" }]);
  });

  it("saves the new image and leaves the replaced object in storage", async () => {
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post saved"),
    );
    // Saved list references the new upload (uploaded before the list
    // save) and keeps the blurb. The replaced image object is left for
    // the cleanup sweep — it may still be referenced elsewhere (e.g. as
    // the site background).
    const [savedList] = vi.mocked(PhotographyService.updateList).mock
      .calls[0] as [Array<PhotographyPost>, TokenGetter];
    expect(savedList[0].images).toEqual([
      { image: "new.png", blurb: "a photo" },
    ]);
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(PhotographyService.updateList).mock.invocationCallOrder[0],
    );
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
    await screen.findByLabelText("Title");

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
      .calls[0] as [Array<PhotographyPost>, TokenGetter];
    expect(savedList[0].images).toEqual([
      { image: "old2.png", blurb: "second" },
      { image: "new.png", blurb: "first" },
    ]);
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(PhotographyService.updateList).mock.invocationCallOrder[0],
    );
  });
});

describe("AdminPhotographyPage deletion", () => {
  // Renders the page, clicks the delete control of the only post, and
  // confirms the deletion dialog.
  async function confirmDelete() {
    const { container, notify, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "trash"));
    await answerYes(adminUi);
    return { notify };
  }

  it("keeps the list intact when saving the shortened list fails", async () => {
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
  });

  it("saves the shortened list and leaves the image objects in storage", async () => {
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post deleted"),
    );
    expect(PhotographyService.updateList).toHaveBeenCalledWith(
      [],
      expect.any(Function),
    );
    // The post's image objects are left for the cleanup sweep — they may
    // still be referenced elsewhere (e.g. as the site background).
  });
});

describe("AdminPhotographyPage creation", () => {
  // Renders the page and clicks the add-item control, so the creation
  // dialog has been handed to confirm().
  async function openCreateConfirmation() {
    const { container, notify, adminUi } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    return { container, notify, adminUi };
  }

  it("creates an empty post and opens it in the editor on Yes", async () => {
    const { notify, adminUi } = await openCreateConfirmation();
    await answerYes(adminUi);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("New photography post created"),
    );
    // The saved list is the existing post plus a fresh empty one.
    const [savedList] = vi.mocked(PhotographyService.updateList).mock
      .calls[0] as [Array<PhotographyPost>, TokenGetter];
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

  it("does nothing until the confirmation is answered", async () => {
    const { notify, adminUi } = await openCreateConfirmation();

    // The page only hands the dialog to confirm(); nothing is created
    // unless the provider runs the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new empty photography post"),
      expect.any(Function),
    );
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("stays on the list when saving the new post fails", async () => {
    vi.mocked(PhotographyService.updateList).mockRejectedValue(
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
    // The editor must not open for a post that was never persisted.
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});

describe("AdminPhotographyPage list reordering", () => {
  let secondPost: PhotographyPost;

  beforeEach(() => {
    secondPost = {
      id: "p2",
      title: "B Post",
      subtitle: "",
      blurb: "",
      images: [],
    };
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

describe("AdminPhotographyPage search", () => {
  beforeEach(() => {
    vi.mocked(PhotographyService.getListFromApi).mockResolvedValue([
      savedPost,
      {
        id: "p2",
        title: "B Post",
        subtitle: "Sub",
        blurb: "Blurb",
        images: [{ image: "x.png", blurb: "caption" }],
      },
    ]);
  });

  it("filters by title, subtitle, blurb and image blurbs", async () => {
    await renderPage();
    const search = screen.getByRole("searchbox", {
      name: "Search photography posts",
    });
    for (const query of ["b post", "sub", "blurb", "caption"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByText("B Post")).toBeInTheDocument();
      expect(screen.queryByText("A Post")).toBeNull();
    }
    fireEvent.change(search, { target: { value: "a photo" } });
    expect(screen.getByText("A Post")).toBeInTheDocument();
    expect(screen.queryByText("B Post")).toBeNull();
  });

  it("opens the post whose title is clicked in a filtered list", async () => {
    const { router } = await renderPage();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search photography posts" }),
      { target: { value: "b post" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "B Post" }));
    await screen.findByLabelText("Title");

    // The clicked title addresses its post by id, so filtering the list
    // down to a single row still opens that row's post and not the first
    // post of the unfiltered list.
    expect(router.state.location.pathname).toBe("/admin/photography/p2");
  });
});

describe("AdminPhotographyPage load failure", () => {
  it("shows a retryable error instead of an empty editable list", async () => {
    vi.mocked(PhotographyService.getListFromApi).mockRejectedValueOnce(
      new Error("GET failed"),
    );
    const { container } = renderAdminPage(
      <AdminPhotographyPage />,
      "/admin/photography/:id?",
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
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByLabelText("Title");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
    expect(PhotographyService.updateList).not.toHaveBeenCalled();
    expect(adminUi.confirm).not.toHaveBeenCalled();
    // Back on the list view.
    iconButton(container, "pencil");
  });
});

describe("AdminPhotographyPage routing", () => {
  it("opens the editor at /admin/photography/:id when editing", async () => {
    const { container, router } = await renderPage();

    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByLabelText("Title");

    expect(router.state.location.pathname).toBe("/admin/photography/p1");
  });

  it("opens the editor directly from an editor URL", async () => {
    renderAdminPage(
      <AdminPhotographyPage />,
      "/admin/photography/:id?",
      "/admin/photography/p1",
    );

    expect(await screen.findByLabelText("Title")).toHaveValue("A Post");
  });

  it("falls back to the list for an unknown editor URL", async () => {
    const { container, router } = renderAdminPage(
      <AdminPhotographyPage />,
      "/admin/photography/:id?",
      "/admin/photography/no-such-id",
    );

    await waitFor(() => iconButton(container, "pencil"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/photography"),
    );
  });

  it("returns to the list on browser back", async () => {
    const { container, router } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByLabelText("Title");

    await act(async () => {
      router.navigate(-1);
    });

    await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
    iconButton(container, "pencil");
  });

  it("asks before discarding an edited title on Close", async () => {
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "New Title" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("treats a pending image file as unsaved changes on Close", async () => {
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByLabelText("Title");
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

  it("returns to the list after a successful save without asking", async () => {
    const { container, notify } = await openEditorAndReplaceImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Photography post saved"),
    );
    // The editor closed to the list with no unsaved-changes dialog.
    await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
    iconButton(container, "pencil");
  });
});
