import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { PhotographyPostEditor } from "./photography-post-editor";
import { EditorImage, newEditorImage } from "./editor-image";
import { PhotographyPost } from "../../../../../models";

function makePost(): PhotographyPost {
  return {
    id: "p1",
    title: "Trip",
    subtitle: "Coast",
    blurb: "Some photos",
    images: [],
  };
}

// Editor image entries with fixed ids so tests can assert identity travel.
function makeImages(): Array<EditorImage> {
  return [
    { id: "img-a", image: "a.jpg", blurb: "first", file: null },
    { id: "img-b", image: "b.jpg", blurb: "second", file: null },
    { id: "img-c", image: "c.jpg", blurb: "third", file: null },
  ];
}

function renderEditor(overrides?: {
  saveDisabled?: boolean;
  images?: Array<EditorImage>;
}) {
  const post = makePost();
  const images = overrides?.images ?? makeImages();
  const setPost = vi.fn();
  const setImages = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  // A router, because the image list is an AdminItemList and that reads
  // its search query from the URL.
  const utils = render(
    <MemoryRouter>
      <PhotographyPostEditor
        post={post}
        setPost={setPost}
        saveDisabled={overrides?.saveDisabled ?? false}
        onSave={onSave}
        onClose={onClose}
        images={images}
        setImages={setImages}
      />
    </MemoryRouter>,
  );
  return { ...utils, post, images, setPost, setImages, onSave, onClose };
}

beforeEach(() => {
  // jsdom does not implement object URLs; PhotoPicker needs one for the
  // preview of entries that carry a pending file.
  window.URL.createObjectURL = vi.fn(() => "blob:preview");
});

// The per-image blurb textareas, in list order.
function imageBlurbs(): Array<HTMLElement> {
  return screen.getAllByRole("textbox", { name: "image blurb or caption" });
}

describe("PhotographyPostEditor", () => {
  it("updates the title without touching the images", () => {
    const { setPost, setImages } = renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "New Trip" },
    });
    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.title).toBe("New Trip");
    expect(updated.subtitle).toBe("Coast");
    expect(setImages).not.toHaveBeenCalled();
  });

  it("updates the subtitle and blurb", () => {
    const { setPost } = renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Subtitle" }), {
      target: { value: "Inland" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Optional blurb" }), {
      target: { value: "New blurb" },
    });
    expect(setPost.mock.calls[0][0].subtitle).toBe("Inland");
    expect(setPost.mock.calls[1][0].blurb).toBe("New blurb");
  });

  it("appends an empty entry with a fresh id on new item", async () => {
    const { setImages } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Add item" }));

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated).toHaveLength(4);
    expect(updated.slice(0, 3)).toEqual(makeImages());
    expect(updated[3]).toEqual({
      id: expect.any(String),
      image: "",
      blurb: "",
      file: null,
    });
    expect(makeImages().map((e) => e.id)).not.toContain(updated[3].id);
  });

  it("deletes an image entry, file and all", async () => {
    const images = makeImages();
    images[1].file = new File(["img"], "pending.png", { type: "image/png" });
    const { setImages, setPost } = renderEditor({ images });

    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated.map((e) => e.id)).toEqual(["img-a", "img-c"]);
    expect(setPost).not.toHaveBeenCalled();
  });

  it("moves an entry down one position, keeping its pending file", async () => {
    const images = makeImages();
    const pending = new File(["img"], "pending.png", { type: "image/png" });
    images[0].file = pending;
    const { setImages } = renderEditor({ images });

    // The first item has no "Move up", so the first "Move down" is item 0's.
    await userEvent.click(
      screen.getAllByRole("button", { name: "Move down" })[0],
    );

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated.map((e) => e.id)).toEqual(["img-b", "img-a", "img-c"]);
    expect(updated[1].file).toBe(pending);
  });

  it("moves an entry up one position", async () => {
    const { setImages } = renderEditor();

    // "Move up" buttons belong to items 1 and 2; take the last item's.
    await userEvent.click(
      screen.getAllByRole("button", { name: "Move up" })[1],
    );

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated.map((e) => e.id)).toEqual(["img-a", "img-c", "img-b"]);
  });

  it("edits a single image's blurb", () => {
    const { setImages } = renderEditor();

    fireEvent.change(imageBlurbs()[1], {
      target: { value: "updated caption" },
    });

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated[1]).toEqual({
      id: "img-b",
      image: "b.jpg",
      blurb: "updated caption",
      file: null,
    });
    expect(updated[0].blurb).toBe("first");
    expect(updated[2].blurb).toBe("third");
  });

  it("stores a chosen file on its entry and clears the stored name", () => {
    const { setImages } = renderEditor();
    const file = new File(["img"], "new.png", { type: "image/png" });

    fireEvent.change(screen.getAllByLabelText("Select Image")[0], {
      target: { files: [file] },
    });

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated[0]).toEqual({
      id: "img-a",
      image: "",
      blurb: "first",
      file,
    });
    expect(updated.slice(1)).toEqual(makeImages().slice(1));
  });

  it("clears only the pending file when the selection is emptied", () => {
    const images = makeImages();
    images[0].file = new File(["img"], "pending.png", { type: "image/png" });
    const { setImages } = renderEditor({ images });

    fireEvent.change(screen.getAllByLabelText("Select Different Image")[0], {
      target: { files: [] },
    });

    const updated = setImages.mock.calls[0][0] as Array<EditorImage>;
    expect(updated[0]).toEqual({
      id: "img-a",
      image: "a.jpg",
      blurb: "first",
      file: null,
    });
  });

  it("saves and closes through the editor controls", async () => {
    const { onSave, onClose } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when the page says so", () => {
    renderEditor({ saveDisabled: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  describe("with live state", () => {
    // A minimal stateful host so reorders round-trip through real state,
    // like in the page component.
    function StatefulEditor() {
      const [post, setPost] = useState(makePost);
      const [images, setImages] = useState(makeImages);
      return (
        <PhotographyPostEditor
          post={post}
          setPost={setPost}
          saveDisabled={false}
          onSave={() => {}}
          onClose={() => {}}
          images={images}
          setImages={setImages}
        />
      );
    }

    it("keeps a typed blurb and its DOM node with the item when moved", async () => {
      render(
        <MemoryRouter>
          <StatefulEditor />
        </MemoryRouter>,
      );

      const firstBlurb = imageBlurbs()[0];
      fireEvent.change(firstBlurb, { target: { value: "typed caption" } });

      await userEvent.click(
        screen.getAllByRole("button", { name: "Move down" })[0],
      );

      const blurbs = imageBlurbs();
      expect(blurbs.map((b) => (b as HTMLTextAreaElement).value)).toEqual([
        "second",
        "typed caption",
        "third",
      ]);
      // Stable ids move the item's DOM node instead of rewriting values in
      // place — the same textarea element now sits in the second slot.
      expect(blurbs[1]).toBe(firstBlurb);
    });
  });
});

describe("newEditorImage", () => {
  it("builds a file-less entry with a unique id", () => {
    const a = newEditorImage("x.jpg", "caption");
    const b = newEditorImage();
    expect(a).toEqual({
      id: expect.any(String),
      image: "x.jpg",
      blurb: "caption",
      file: null,
    });
    expect(b).toEqual({
      id: expect.any(String),
      image: "",
      blurb: "",
      file: null,
    });
    expect(a.id).not.toBe(b.id);
  });
});
