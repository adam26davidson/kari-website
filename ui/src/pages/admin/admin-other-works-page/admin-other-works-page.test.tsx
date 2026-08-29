import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { AdminOtherWorksPage } from "./admin-other-works-page";
import { BlogPost } from "../../../models";
import { BlogService } from "../../../services/blog";
import { ImageService } from "../../../services/images";
import { TokenGetter } from "../../../services/http";
import { answerYes, renderAdminPage } from "../admin-ui-test-helpers";
import {
  applyTimeZone,
  restoreHostTimeZoneAfterEach,
} from "../../../test/timezone";

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
    setPublished: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// The rich-text editor pulls in the whole tiptap stack; stub it with a
// plain textarea so the tests exercise only the page's own logic. The
// "attach pending file" button mirrors what the real editor's image
// button does: hand the picked file to onAddImage under a fresh id and
// insert an img whose title carries that id (the base64 src is what the
// real editor shows before upload).
vi.mock("../components/tiptap/tiptap", () => ({
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

/**
 * A per-row control located by its FontAwesome glyph. Since #457 edit and
 * delete are labelled .admin-button text buttons and the move arrows are
 * .admin-icon-button circles, so this closes on the button element itself
 * rather than on either class.
 */
function iconButton(container: HTMLElement, icon: string): HTMLElement {
  const button = container
    .querySelector(`svg[data-icon="${icon}"]`)
    ?.closest("button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

/**
 * The editor's Save control. A floppy-disk icon circle until #457 made it
 * a labelled text button; it is the first control in the editor header.
 */
function saveButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector(
    ".data-editor-item-controls .admin-button",
  );
  if (!(button instanceof HTMLElement)) {
    throw new Error("no save button in the editor");
  }
  return button;
}

// The saved post as it exists in the published list before the edit, and
// its stored content, which references old.png.
let savedPost: BlogPost;
const savedContent =
  '<p>hello</p><img src="https://api.test.local/images/old.png">';

async function renderPage(initialEntry?: string) {
  const { container, adminUi, router } = renderAdminPage(
    <AdminOtherWorksPage />,
    "/admin/other-works/:id?",
    initialEntry,
  );
  const notify = adminUi.notify;
  await waitFor(() => iconButton(container, "pencil"));
  return { container, notify, adminUi, router };
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminOtherWorksPage image removal on save", () => {
  it("keeps the image when saving the list fails", async () => {
    vi.mocked(BlogService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // Content-first ordering: the content had already been written when
    // the list save failed.
    expect(BlogService.updateContent).toHaveBeenCalledOnce();
    expect(
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0],
    );
  });

  it("keeps the image when saving the content fails", async () => {
    vi.mocked(BlogService.updateContent).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      ),
    );
  });

  it("saves content then list, leaving the removed image in storage", async () => {
    const { container, notify } = await openEditorAndRemoveImage();

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    // The removed image's object is left for the image-cleanup sweep —
    // it may still be referenced elsewhere (e.g. as the site
    // background). Content save strictly before the list save.
    expect(
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0],
    );
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

    fireEvent.click(saveButton(container));
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

    fireEvent.click(saveButton(container));

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

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      "b1",
      savedContent,
      false,
      expect.any(Function),
    );
  });

  it("strips wrappers from legacy content stored as a full document", async () => {
    vi.mocked(BlogService.getContent).mockResolvedValue(
      `<html><head></head><body>${savedContent}</body></html>`,
    );
    const { container, notify } = await openEditor();

    fireEvent.click(saveButton(container));

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
  });
});

describe("AdminOtherWorksPage publish/unpublish atomicity", () => {
  const apiImg = (name: string) => `https://api.test.local/images/${name}`;
  // Public URLs name the original inside the image's own directory (#273).
  const s3Img = (id: string) =>
    `https://s3.test.local/images/${id}/original${
      /\.[a-zA-Z0-9]+$/.exec(id)?.[0].toLowerCase() ?? ""
    }`;
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

      fireEvent.click(saveButton(container));

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
      const lastFlip = vi.mocked(ImageService.setPublished).mock
        .invocationCallOrder[1];
      const contentOrder = vi.mocked(BlogService.updateContent).mock
        .invocationCallOrder[0];
      const listOrder = vi.mocked(BlogService.updateList).mock
        .invocationCallOrder[0];
      expect(lastFlip).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(listOrder);
    });

    it("flips only images with a real file name when publishing", async () => {
      // A trailing-slash src has no extractable file name; its visibility
      // cannot be flipped, but the publish still goes through.
      vi.mocked(BlogService.getContent).mockResolvedValue(
        draftContent + '<img src="https://api.test.local/images/">',
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith("Other works item saved"),
      );
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", true, expect.any(Function)],
        ["b.png", true, expect.any(Function)],
      ]);
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

      fireEvent.click(saveButton(container));

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

      fireEvent.click(saveButton(container));

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

      fireEvent.click(saveButton(container));

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

    it("reports loudly when flipping images back also fails", async () => {
      // The publish flip fails mid-loop, and un-flipping the already
      // flipped image fails too — the images are left half-flipped.
      vi.mocked(ImageService.setPublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && isPublished) {
            throw new Error("flip failed");
          }
          if (fileName === "a.png" && !isPublished) {
            throw new Error("unflip failed");
          }
        },
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("rolling back was incomplete"),
          "error",
        ),
      );
      // The draft content and list were never touched.
      expect(BlogService.updateContent).not.toHaveBeenCalled();
      expect(BlogService.updateList).not.toHaveBeenCalled();
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

      fireEvent.click(saveButton(container));

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

      fireEvent.click(saveButton(container));

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
      const listOrder = vi.mocked(BlogService.updateList).mock
        .invocationCallOrder[0];
      const contentOrder = vi.mocked(BlogService.updateContent).mock
        .invocationCallOrder[0];
      const firstFlip = vi.mocked(ImageService.setPublished).mock
        .invocationCallOrder[0];
      expect(listOrder).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(firstFlip);
    });

    it("changes nothing else when hiding the post fails", async () => {
      vi.mocked(BlogService.updateList).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Failed to save — your change was not saved",
          "error",
        ),
      );
      expect(BlogService.updateContent).not.toHaveBeenCalled();
      expect(ImageService.setPublished).not.toHaveBeenCalled();
    });

    it("restores the published list when the content save fails", async () => {
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

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

    it("reports loudly when restoring the list after a failed content save also fails", async () => {
      // The draft content save fails after the list already hid the post,
      // and restoring the published list fails too.
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      vi.mocked(BlogService.updateList)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("rollback PUT failed"));
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("rolling back was incomplete"),
          "error",
        ),
      );
      // Both the unpublish list save and the restore attempt were made.
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
      expect(ImageService.setPublished).not.toHaveBeenCalled();
    });

    it("reports loudly when rolling back a failed image flip also fails", async () => {
      // The private flip fails mid-loop, and restoring the published
      // content during the rollback fails too.
      vi.mocked(ImageService.setPublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && !isPublished) {
            throw new Error("flip failed");
          }
        },
      );
      vi.mocked(BlogService.updateContent)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("rollback PUT failed"));
      const { container, notify } = await openEditorAndTogglePublished();

      fireEvent.click(saveButton(container));

      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("rolling back was incomplete"),
          "error",
        ),
      );
      // The flipped image was restored before the content rollback failed.
      expect(callsOf(ImageService.setPublished)).toEqual([
        ["a.png", false, expect.any(Function)],
        ["b.png", false, expect.any(Function)],
        ["a.png", true, expect.any(Function)],
      ]);
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

      fireEvent.click(saveButton(container));

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
    });
  });

  describe("saving without a publish flip", () => {
    it("writes content first, so a content failure leaves the list untouched", async () => {
      vi.mocked(BlogService.updateContent).mockRejectedValue(
        new Error("PUT failed"),
      );
      const { container, notify } = await openEditorAndRemoveImage();

      fireEvent.click(saveButton(container));

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
    });
  });
});

describe("AdminOtherWorksPage deletion", () => {
  // Renders the page, clicks the delete control of the only post, and
  // confirms the deletion dialog.
  async function confirmDelete() {
    const { container, notify, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "trash"));
    await answerYes(adminUi);
    return { notify };
  }

  it("keeps the content when saving the shortened list fails", async () => {
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
    // Still-referenced content must never be deleted on a failed save.
    expect(BlogService.deleteContent).not.toHaveBeenCalled();
  });

  it("deletes the content only after the shortened list is saved", async () => {
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
    // List save strictly before the content deletion. The item's image
    // objects are left for the image-cleanup sweep — they may still be
    // referenced elsewhere (e.g. as the site background).
    expect(
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(BlogService.deleteContent).mock.invocationCallOrder[0],
    );
  });
});

describe("AdminOtherWorksPage creation", () => {
  // Renders the page and clicks the add-item control, so the creation
  // dialog has been handed to confirm().
  async function openCreateConfirmation() {
    const { container, notify, adminUi } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add a post" }));
    return { container, notify, adminUi };
  }

  it("creates an empty draft and opens it in the editor on Yes", async () => {
    const { notify, adminUi } = await openCreateConfirmation();
    await answerYes(adminUi);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("New other works item created"),
    );
    // The saved list is the existing post plus a fresh unpublished one.
    const [savedList] = vi.mocked(BlogService.updateList).mock.calls[0] as [
      Array<BlogPost>,
      TokenGetter,
    ];
    expect(savedList).toHaveLength(2);
    expect(savedList[0]).toEqual(savedPost);
    expect(savedList[1]).toMatchObject({ title: "", isPublished: false });
    expect(savedList[1].id).not.toBe("");
    // Empty content is created for the new id, after the list save.
    expect(BlogService.updateContent).toHaveBeenCalledWith(
      savedList[1].id,
      "",
      false,
      expect.any(Function),
    );
    expect(
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0],
    );
    // The new post is open in the editor.
    await screen.findByPlaceholderText("post content");
  });

  it("does nothing until the confirmation is answered", async () => {
    const { notify, adminUi } = await openCreateConfirmation();

    // The page only hands the dialog to confirm(); nothing is created
    // unless the provider runs the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new empty other works item"),
      expect.any(Function),
    );
    expect(BlogService.updateList).not.toHaveBeenCalled();
    expect(BlogService.updateContent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("post content")).toBeNull();
  });

  it("aborts before creating content when the list save fails", async () => {
    vi.mocked(BlogService.updateList).mockRejectedValue(
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
    expect(BlogService.updateContent).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("post content")).toBeNull();
  });

  it("stays on the list when creating the empty content fails", async () => {
    vi.mocked(BlogService.updateContent).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { notify, adminUi } = await openCreateConfirmation();
    await answerYes(adminUi);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to create other works item",
        "error",
      ),
    );
    // The editor must not open without its content object.
    expect(screen.queryByPlaceholderText("post content")).toBeNull();
  });
});

/** The date text the list row for the given title actually renders. */
function displayedDate(title: string): string {
  const row = screen
    .getByRole("button", { name: title })
    .closest(".blog-post-summary");
  return row?.querySelector("span")?.textContent ?? "";
}

describe("AdminOtherWorksPage search", () => {
  beforeEach(() => {
    vi.mocked(BlogService.getListFromApi).mockResolvedValue([
      savedPost,
      {
        id: "b2",
        title: "B Post",
        date: "2024-06-15T00:00:00.000Z",
        isPublished: false,
      },
    ]);
  });

  it("filters by title and by the date as stored or displayed", async () => {
    await renderPage();
    const search = screen.getByRole("searchbox", {
      name: "Search other works",
    });
    fireEvent.change(search, { target: { value: "b post" } });
    expect(screen.getByText("B Post")).toBeInTheDocument();
    expect(screen.queryByText("A Post")).toBeNull();
    fireEvent.change(search, { target: { value: "2024-05" } });
    expect(screen.getByText("A Post")).toBeInTheDocument();
    expect(screen.queryByText("B Post")).toBeNull();
    // Search by the exact string the row renders, read back out of the
    // DOM: if the displayed format and the searched format ever drift
    // apart, this stops matching.
    fireEvent.change(search, { target: { value: displayedDate("A Post") } });
    expect(screen.getByText("A Post")).toBeInTheDocument();
    expect(screen.queryByText("B Post")).toBeNull();
  });

  it("opens the post whose title is clicked in a filtered list", async () => {
    const { router } = await renderPage();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search other works" }),
      { target: { value: "b post" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "B Post" }));
    await screen.findByPlaceholderText("post content");

    // The clicked title addresses its post by id, so filtering the list
    // down to a single row still opens that row's post and not the first
    // post of the unfiltered list.
    expect(router.state.location.pathname).toBe("/admin/other-works/b2");
  });
});

describe("AdminOtherWorksPage list reordering", () => {
  let secondPost: BlogPost;

  beforeEach(() => {
    secondPost = {
      id: "b2",
      title: "B Post",
      date: "2024-06-01T00:00:00.000Z",
      isPublished: false,
    };
    vi.mocked(BlogService.getListFromApi).mockResolvedValue([
      savedPost,
      secondPost,
    ]);
  });

  it("saves the reordered list on move down", async () => {
    const { notify } = await renderPage();
    // Only the first item has a move-down control.
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(BlogService.updateList).toHaveBeenCalledWith(
      [secondPost, savedPost],
      expect.any(Function),
    );
  });

  it("saves the reordered list on move up", async () => {
    const { notify } = await renderPage();
    // Only the second item has a move-up control.
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Order updated"));
    expect(BlogService.updateList).toHaveBeenCalledWith(
      [secondPost, savedPost],
      expect.any(Function),
    );
  });
});

describe("AdminOtherWorksPage opening the editor", () => {
  it("does not open the editor when loading the content fails", async () => {
    vi.mocked(BlogService.getContent).mockRejectedValue(
      new Error("GET failed"),
    );
    const { container, notify } = await renderPage();

    fireEvent.click(iconButton(container, "pencil"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Failed to load content", "error"),
    );
    // Never open the editor with missing content — saving it would
    // overwrite the real content.
    expect(screen.queryByPlaceholderText("post content")).toBeNull();
  });
});

describe("AdminOtherWorksPage load failure", () => {
  it("shows a retryable error instead of an empty editable list", async () => {
    vi.mocked(BlogService.getListFromApi).mockRejectedValueOnce(
      new Error("GET failed"),
    );
    const { container } = renderAdminPage(
      <AdminOtherWorksPage />,
      "/admin/other-works/:id?",
    );

    await screen.findByText("Failed to load other works.");
    // No editable list — saving one would overwrite the real data.
    expect(screen.queryByRole("button", { name: "Add a post" })).toBeNull();

    // Retry reloads and shows the list.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => iconButton(container, "pencil"));
  });
});

describe("AdminOtherWorksPage closing the editor", () => {
  it("abandons the open post without saving", async () => {
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("post content")).toBeNull(),
    );
    expect(BlogService.updateList).not.toHaveBeenCalled();
    expect(BlogService.updateContent).not.toHaveBeenCalled();
    expect(adminUi.confirm).not.toHaveBeenCalled();
    // Back on the list view.
    iconButton(container, "pencil");
  });
});

describe("AdminOtherWorksPage routing", () => {
  it("keeps the search filter through the editor round trip", async () => {
    const { container, router } = await renderPage("/admin/other-works?q=post");

    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("post content")).toBeNull(),
    );
    expect(router.state.location.search).toBe("?q=post");
  });

  it("opens the editor at /admin/other-works/:id when editing", async () => {
    const { container, router } = await renderPage();

    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");

    expect(router.state.location.pathname).toBe("/admin/other-works/b1");
  });

  it("opens the editor directly from an editor URL", async () => {
    renderAdminPage(
      <AdminOtherWorksPage />,
      "/admin/other-works/:id?",
      "/admin/other-works/b1",
    );

    expect(await screen.findByPlaceholderText("post content")).toHaveValue(
      savedContent,
    );
  });

  it("falls back to the list for an unknown editor URL", async () => {
    const { container, router } = renderAdminPage(
      <AdminOtherWorksPage />,
      "/admin/other-works/:id?",
      "/admin/other-works/no-such-id",
    );

    await waitFor(() => iconButton(container, "pencil"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/other-works"),
    );
  });

  it("returns to the list URL when loading the content fails", async () => {
    vi.mocked(BlogService.getContent).mockRejectedValue(
      new Error("GET failed"),
    );
    const { container, notify, router } = await renderPage();

    fireEvent.click(iconButton(container, "pencil"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Failed to load content", "error"),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/other-works"),
    );
    iconButton(container, "pencil");
  });

  it("returns to the list on browser back", async () => {
    const { container, router } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");

    await act(async () => {
      router.navigate(-1);
    });

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("post content")).toBeNull(),
    );
    iconButton(container, "pencil");
  });

  it("asks before discarding edited content on Close", async () => {
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    const textarea = await screen.findByPlaceholderText("post content");
    fireEvent.change(textarea, { target: { value: "<p>changed</p>" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("asks before discarding an edited title on Close", async () => {
    const { container, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New Title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("returns to the list after a successful save without asking", async () => {
    const { container, notify, adminUi } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    const textarea = await screen.findByPlaceholderText("post content");
    fireEvent.change(textarea, { target: { value: "<p>hello</p>" } });

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Other works item saved"),
    );
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("post content")).toBeNull(),
    );
    expect(adminUi.confirm).not.toHaveBeenCalled();
    iconButton(container, "pencil");
  });
});

describe("AdminOtherWorksPage image upload on save", () => {
  it("treats an empty upload result as a failed upload", async () => {
    vi.mocked(ImageService.upload).mockResolvedValue("");
    const { container, notify } = await renderPage();
    fireEvent.click(iconButton(container, "pencil"));
    await screen.findByPlaceholderText("post content");
    fireEvent.click(screen.getByText("attach pending file"));

    fireEvent.click(saveButton(container));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      ),
    );
    // Nothing was saved or deleted for a post whose upload failed.
    expect(BlogService.updateContent).not.toHaveBeenCalled();
    expect(BlogService.updateList).not.toHaveBeenCalled();
  });
});

describe("AdminOtherWorksPage new item", () => {
  restoreHostTimeZoneAfterEach();
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates a new item at UTC midnight of the author's calendar day", async () => {
    // Created at 17:00 PST on Jan 1 (01:00 UTC on Jan 2): the stored date
    // must be Jan 1, the day the author sees, so formatPostDate (which
    // reads the UTC day) shows the same day everywhere.
    applyTimeZone("America/Los_Angeles");
    vi.useFakeTimers({
      now: new Date(2026, 0, 1, 17, 0, 0),
      shouldAdvanceTime: true,
    });
    const { adminUi } = await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add a post" }));
    await answerYes(adminUi);

    await waitFor(() => expect(BlogService.updateList).toHaveBeenCalled());
    const [savedList] = vi.mocked(BlogService.updateList).mock.calls[0];
    const created = (savedList as BlogPost[]).find((p) => p.id !== "b1");
    expect(created?.date).toBe("2026-01-01T00:00:00.000Z");
  });
});
