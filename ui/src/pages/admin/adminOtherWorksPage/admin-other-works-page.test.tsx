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
// plain textarea so the tests exercise only the page's own logic.
vi.mock("../../../components/tiptap/tiptap", () => ({
  Tiptap: ({
    content,
    setContent,
  }: {
    content: string;
    setContent: (content: string | null) => void;
  }) => (
    <textarea
      placeholder="post content"
      value={content}
      onChange={(e) => setContent(e.target.value)}
    />
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
    expect(BlogService.updateContent).not.toHaveBeenCalled();
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
    // List save -> content save -> image delete, strictly in that order.
    const listOrder =
      vi.mocked(BlogService.updateList).mock.invocationCallOrder[0];
    const contentOrder =
      vi.mocked(BlogService.updateContent).mock.invocationCallOrder[0];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(listOrder).toBeLessThan(contentOrder);
    expect(contentOrder).toBeLessThan(deleteOrder);
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
