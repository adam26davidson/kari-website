import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminOtherWorksPage } from "./admin-other-works-page";
import { BlogPost } from "../../../Models";
import { BlogService } from "../../../services/blog";
import { ImageService } from "../../../services/images";

vi.mock("../../../services/blog", () => ({
  BlogService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
    getContent: vi.fn(),
    updateContent: vi.fn(),
    deleteContent: vi.fn(),
  },
}));

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    delete: vi.fn(),
    setPublished: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

// The rich-text editor pulls in the whole tiptap stack; stub it with a
// plain textarea so the tests exercise only the page's own logic. The
// "attach pending file" button mirrors what the real editor's image
// button does: hand the picked file to onAddImage under a fresh id and
// insert an img whose title carries that id (the base64 src is what the
// real editor shows before upload).
vi.mock("../../../components/tiptap/tiptap", () => ({
  Tiptap: ({
    content,
    setContent,
    onAddImage,
  }: {
    content: string;
    setContent: (content: string | null) => void;
    onAddImage: (file: File, id: string) => void;
  }) => (
    <>
      <textarea
        placeholder="post content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          onAddImage(
            new File(["img"], "fresh.png", { type: "image/png" }),
            "pending-1",
          );
          setContent(
            `${content}<img src="data:image/png;base64,AAAA" title="pending-1">`,
          );
        }}
      >
        attach pending file
      </button>
    </>
  ),
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

// The saved post as it exists in the published list before the edit, and
// its stored content, which references old.png.
let savedPost: BlogPost;
const savedContent =
  '<p>hello</p><img src="https://api.test.local/images/old.png">';

async function renderPage() {
  const notify = vi.fn();
  const setConfirmation = vi.fn();
  const { container } = render(
    <AdminOtherWorksPage
      setLoading={vi.fn()}
      setConfirmation={setConfirmation}
      notify={notify}
    />,
  );
  await waitFor(() => iconButton(container, "pencil"));
  return { container, notify, setConfirmation };
}

// Renders the page, opens the only post in the editor, and removes the
// image from its content — the state right before the user hits save.
async function openEditorAndRemoveImage() {
  const { container, notify } = await renderPage();
  fireEvent.click(iconButton(container, "pencil"));
  const textarea = await screen.findByPlaceholderText("post content");
  fireEvent.change(textarea, { target: { value: "<p>hello</p>" } });
  return { container, notify };
}

beforeEach(() => {
  savedPost = {
    id: "b1",
    title: "A Post",
    date: "2024-05-01T00:00:00.000Z",
    isPublished: false,
  };
  vi.mocked(BlogService.getListFromApi).mockResolvedValue([savedPost]);
  vi.mocked(BlogService.updateList).mockResolvedValue(undefined);
  vi.mocked(BlogService.getContent).mockResolvedValue(savedContent);
  vi.mocked(BlogService.updateContent).mockResolvedValue(undefined);
  vi.mocked(BlogService.deleteContent).mockResolvedValue(undefined);
  vi.mocked(ImageService.delete).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminOtherWorksPage image removal on save", () => {
  it("keeps the image when saving the list fails", async () => {
    vi.mocked(BlogService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // The still-referenced image must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
    // Content-first ordering: the content had already been written when
    // the list save failed.
    expect(BlogService.updateContent).toHaveBeenCalledOnce();
    expect(
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(BlogService.updateList).mock.invocationCallOrder[0]);
  });

  it("keeps the image when saving the content fails", async () => {
    vi.mocked(BlogService.updateContent).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      ),
    );
    // The stored content still references the image, so it must survive.
    expect(ImageService.delete).not.toHaveBeenCalled();
  });

  it("deletes the removed image only after the content save succeeds", async () => {
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    // Content save -> list save -> image delete, strictly in that order.
    const listOrder =
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0];
    const contentOrder =
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(contentOrder).toBeLessThan(listOrder);
    expect(listOrder).toBeLessThan(deleteOrder);
  });
});

describe("AdminOtherWorksPage pending image files", () => {
  it("keeps a pending file attached to its image through a content reorder", async () => {
    vi.mocked(ImageService.upload).mockResolvedValue("fresh-uploaded.png");
    const { container, notify } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    const textarea = await screen.findByPlaceholderText("post content");

    // Attach a not-yet-uploaded image (its img lands last in the
    // content)...
    fireEvent.click(screen.getByText("attach pending file"));
    // ...then reorder it to the front, ahead of the stored image.
    fireEvent.change(textarea, {
      target: {
        value:
          '<img src="data:image/png;base64,AAAA" title="pending-1">' +
          savedContent,
      },
    });

    fireEvent.click(iconButton(container, "floppy-disk"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );

    // The pending file traveled with its img (keyed by the id on the img
    // title, not by position): exactly one upload, of the freshly picked
    // file, and the saved content has the uploaded name in the moved-to
    // position with the stored image untouched after it.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    const [uploadedFile, uploadedAsPublished] = vi.mocked(ImageService.upload)
      .mock.calls[0];
    expect(uploadedFile?.name).toBe("fresh.png");
    expect(uploadedAsPublished).toBe(false);
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      "b1",
      '<img src="https://api.test.local/images/fresh-uploaded.png" title="pending-1">' +
        savedContent,
      false,
      expect.any(Function),
    );
    // Nothing was removed from the content, so nothing is deleted.
    expect(ImageService.delete).not.toHaveBeenCalled();
  });
});

describe("AdminOtherWorksPage content serialization on save", () => {
  // Renders the page and opens the only post in the editor without
  // touching its content — the state right before an unchanged re-save.
  async function openEditor() {
    const { container, notify } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");
    return { container, notify };
  }

  it("saves the body fragment without html/head/body wrappers", async () => {
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    // Exactly the fragment the editor holds — no document wrappers.
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      "b1",
      "<p>hello</p>",
      false,
      expect.any(Function),
    );
  });

  it("re-saves already-clean content byte-for-byte (round-trip no-op)", async () => {
    const { container, notify } = await openEditor();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      "b1",
      savedContent,
      false,
      expect.any(Function),
    );
    // Nothing changed, so no image is deleted either.
    expect(ImageService.delete).not.toHaveBeenCalled();
  });

  it("strips wrappers from legacy content stored as a full document", async () => {
    vi.mocked(BlogService.getContent).mockResolvedValue(
      `<html><head></head><body>${savedContent}</body></html>`,
    );
    const { container, notify } = await openEditor();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    // Re-saving a post persisted before this fix converges to the clean
    // fragment instead of accumulating wrappers.
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      "b1",
      savedContent,
      false,
      expect.any(Function),
    );
    expect(ImageService.delete).not.toHaveBeenCalled();
  });
});

describe("AdminOtherWorksPage publish/unpublish atomicity", () => {
  const apiImg = (name: string) => `https://api.test.local/images/${name}`;
  const s3Img = (name: string) => `https://s3.test.local/images/${name}`;
  const draftContent = `<img src="${apiImg("a.png")}"><img src="${apiImg(
    "b.png",
  )}">`;
  const publishedContent = `<img src="${s3Img("a.png")}"><img src="${s3Img(
    "b.png",
  )}">`;

  // Opens the only post in the editor and toggles its published checkbox
  // — the state right before the user hits save on a publish/unpublish.
  async function openEditorAndTogglePublished() {
    const { container, notify } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");
    fireEvent.click(screen.getByRole("checkbox"));
    return { container, notify };
  }

  function callsOf(fn: (...args: never[]) => unknown) {
    return vi.mocked(fn).mock.calls;
  }

  describe("publishing a draft", () => {
    beforeEach(() => {
      savedPost.isPublished = false;
      vi.mocked(BlogService.getContent).mockResolvedValue(draftContent);
      vi.mocked(ImageService.setPublished).mockResolvedValue(undefined);
    });

    it("flips images public, then saves content, then the list", async () => {
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith("Other works item saved"),
      );
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", true, expect.any(Function)],
        ["b.png", true, expect.any(Function)],
      ]);
      expect(BlogService.updateContent).toHaveBeenCalledWith(
        "b1",
        publishedContent,
        true,
        expect.any(Function),
      );
      expect(BlogService.updateList).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "b1", isPublished: true })],
        expect.any(Function),
      );
      // Images public -> content public -> list flips to published; the
      // list is the commit point and must come last.
      const lastFlip =
        vi.mocked(ImageService.setPublished).mock.invocationCallOrder[1];
      const contentOrder =
        vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0];
      const listOrder =
        vi.mocked(BlogService.updateList).mock.invocationCallOrder[0];
      expect(lastFlip).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(listOrder);
    });

    it("flips already-flipped images back when a flip fails mid-loop", async () => {
      vi.mocked(ImageService.setPublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && isPublished) {
            throw new Error("flip failed");
          }
        },
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save other works item",
          "error",
        ),
      );
      // a.png was flipped public, so it must be flipped back private; the
      // draft content and list must never have been touched.
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", true, expect.any(Function)],
        ["b.png", true, expect.any(Function)],
        ["a.png", false, expect.any(Function)],
      ]);
      expect(BlogService.updateContent).not.toHaveBeenCalled();
      expect(BlogService.updateList).not.toHaveBeenCalled();
    });

    it("flips images back when the content save fails", async () => {
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save other works item",
          "error",
        ),
      );
      // The failed PUT left the draft content object untouched; both
      // images return to private and the list is never flipped.
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", true, expect.any(Function)],
        ["b.png", true, expect.any(Function)],
        ["a.png", false, expect.any(Function)],
        ["b.png", false, expect.any(Function)],
      ]);
      expect(BlogService.updateList).not.toHaveBeenCalled();
    });

    it("restores draft content and image visibility when the list save fails", async () => {
      vi.mocked(BlogService.updateList).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save — your change was not saved",
          "error",
        ),
      );
      // The public list still says draft, so the published content that
      // was written is rolled back to the original draft content and the
      // images are flipped back to private. (The toast above fires before
      // the rollback runs, so the rollback calls each get their own
      // waitFor.)
      await waitFor(() =>
        expect(callsOf(BlogService.updateContent)).toEqual([
          ["b1", publishedContent, true, expect.any(Function)],
          ["b1", draftContent, false, expect.any(Function)],
        ]),
      );
      await waitFor(() =>
        expect(callsOf(ImageService.setPublished)).toEqual([
          ["a.png", true, expect.any(Function)],
          ["b.png", true, expect.any(Function)],
          ["a.png", false, expect.any(Function)],
          ["b.png", false, expect.any(Function)],
        ]),
      );
    });

    it("reports loudly when the rollback itself fails", async () => {
      vi.mocked(BlogService.updateList).mockRejectedValue(
        new Error("PUT failed"),
      );
      // First content PUT (publish) succeeds, rollback PUT fails.
      vi.mocked(BlogService.updateContent)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("rollback PUT failed"));
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("rolling back was incomplete"),
          "error",
        ),
      );
    });
  });

  describe("unpublishing a published post", () => {
    beforeEach(() => {
      savedPost.isPublished = true;
      vi.mocked(BlogService.getContent).mockResolvedValue(publishedContent);
      vi.mocked(ImageService.setPublished).mockResolvedValue(undefined);
    });

    it("hides the post first, then saves content, then flips images", async () => {
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith("Other works item saved"),
      );
      expect(BlogService.updateList).toHaveBeenCalledWith(
        [expect.objectContaining({ id: "b1", isPublished: false })],
        expect.any(Function),
      );
      expect(BlogService.updateContent).toHaveBeenCalledWith(
        "b1",
        draftContent,
        false,
        expect.any(Function),
      );
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", false, expect.any(Function)],
        ["b.png", false, expect.any(Function)],
      ]);
      // List (hides the post) -> content -> image flips: nothing public
      // may ever reference a private object.
      const listOrder =
        vi.mocked(BlogService.updateList).mock.invocationCallOrder[0];
      const contentOrder =
        vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0];
      const firstFlip =
        vi.mocked(ImageService.setPublished).mock.invocationCallOrder[0];
      expect(listOrder).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(firstFlip);
    });

    it("changes nothing else when hiding the post fails", async () => {
      vi.mocked(BlogService.updateList).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save — your change was not saved",
          "error",
        ),
      );
      expect(BlogService.updateContent).not.toHaveBeenCalled();
      expect(ImageService.setPublished).not.toHaveBeenCalled();
      expect(ImageService.delete).not.toHaveBeenCalled();
    });

    it("restores the published list when the content save fails", async () => {
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save other works item",
          "error",
        ),
      );
      // The published content object is untouched (the PUT failed), so
      // restoring the list restores the previous state exactly.
      await waitFor(() =>
        expect(callsOf(BlogService.updateList)).toEqual([
          [
            [expect.objectContaining({ id: "b1", isPublished: false })],
            expect.any(Function),
          ],
          [
            [expect.objectContaining({ id: "b1", isPublished: true })],
            expect.any(Function),
          ],
        ]),
      );
      expect(ImageService.setPublished).not.toHaveBeenCalled();
    });

    it("rolls the whole unpublish back when a flip fails mid-loop", async () => {
      vi.mocked(ImageService.setPublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && !isPublished) {
            throw new Error("flip failed");
          }
        },
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save other works item",
          "error",
        ),
      );
      // a.png went private and comes back public...
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", false, expect.any(Function)],
        ["b.png", false, expect.any(Function)],
        ["a.png", true, expect.any(Function)],
      ]);
      // ...then the published content and the published list are restored.
      expect(callsOf(BlogService.updateContent)).toEqual([
        ["b1", draftContent, false, expect.any(Function)],
        ["b1", publishedContent, true, expect.any(Function)],
      ]);
      expect(callsOf(BlogService.updateList)).toEqual([
        [
          [expect.objectContaining({ id: "b1", isPublished: false })],
          expect.any(Function),
        ],
        [
          [expect.objectContaining({ id: "b1", isPublished: true })],
          expect.any(Function),
        ],
      ]);
      expect(ImageService.delete).not.toHaveBeenCalled();
    });
  });

  describe("saving without a publish flip", () => {
    it("writes content first, so a content failure leaves the list untouched", async () => {
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndRemoveImage();

      fireEvent.click(iconButton(container, "floppy-disk"));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save other works item",
          "error",
        ),
      );
      // Content goes first on a no-flip save: the failed PUT must not
      // leave new metadata (title/date) pointing at old content, so the
      // list is never written and nothing else is touched.
      expect(BlogService.updateList).not.toHaveBeenCalled();
      expect(ImageService.setPublished).not.toHaveBeenCalled();
      expect(ImageService.delete).not.toHaveBeenCalled();
    });
  });
});

describe("AdminOtherWorksPage deletion", () => {
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

  it("keeps content and images when saving the shortened list fails", async () => {
    vi.mocked(BlogService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // Still-referenced content and images must never be deleted on a
    // failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(BlogService.deleteContent).not.toHaveBeenCalled();
  });

  it("aborts before touching the list when fetching the content fails", async () => {
    vi.mocked(BlogService.getContent).mockRejectedValue(
      new Error("fetch failed"),
    );
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to delete other works item",
        "error",
      ),
    );
    expect(BlogService.updateList).not.toHaveBeenCalled();
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(BlogService.deleteContent).not.toHaveBeenCalled();
  });

  it("deletes content and images only after the shortened list is saved", async () => {
    const { notify } = await confirmDelete();

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item deleted"),
    );
    expect(BlogService.updateList).toHaveBeenCalledWith(
      [],
      expect.any(Function),
    );
    await waitFor(() =>
      expect(BlogService.deleteContent).toHaveBeenCalledWith(
        "b1",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledWith(
      "old.png",
      expect.any(Function),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    // List save strictly before any S3 object deletion.
    const listOrder =
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0];
    expect(listOrder).toBeLessThan(
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0],
    );
    expect(listOrder).toBeLessThan(
      vi.mocked(BlogService.deleteContent).mock.invocationCallOrder[0],
    );
  });
});
