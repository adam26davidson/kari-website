import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PhotographyPostEditor } from "./photography-post-editor";
import { EditorImage, newEditorImage } from "./editor-image";
import { PhotographyPost } from "@kari/shared/models";

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
  const utils = render(
    <PhotographyPostEditor
      post={post}
      setPost={setPost}
      saveDisabled={overrides?.saveDisabled ?? false}
      onSave={onSave}
      onClose={onClose}
      images={images}
      setImages={setImages}
    />,
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
  return screen.getAllByRole("textbox", { name: "Caption (optional)" });
}

describe("PhotographyPostEditor", () => {
  it("says what it is editing and labels every field", () => {
    renderEditor();
    expect(
      screen.getByRole("heading", { name: "Edit photography post" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Trip");
    expect(screen.getByLabelText("Subtitle")).toHaveValue("Coast");
    expect(screen.getByLabelText("Blurb (optional)")).toBeInTheDocument();
    // One "Photo" group label per image row.
    expect(screen.getAllByText("Photo")).toHaveLength(3);
  });

  // Design brief §2: one obvious next action per screen. "Add an image"
  // and Save were both filled brown and competed as equals (#457).
  it("leaves Save as the only primary action on the screen", () => {
    renderEditor();
    // The filled-green recipe's own class (button-variants.ts): after the
    // migration Save and Close are shadcn `Button`s and carry no
    // `admin-button` class to sort by, and `bg-primary` is what "filled
    // green primary" now IS. PhotoPicker's "Select an image" is an
    // AdminButton, but a secondary one, so it is excluded on the same test.
    const filled = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("bg-primary"))
      .map((button) => button.textContent);
    expect(filled).toEqual(["Save"]);
  });

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
    fireEvent.change(screen.getByRole("textbox", { name: "Blurb (optional)" }), {
      target: { value: "New blurb" },
    });
    expect(setPost.mock.calls[0][0].subtitle).toBe("Inland");
    expect(setPost.mock.calls[1][0].blurb).toBe("New blurb");
  });

  it("appends an empty entry with a fresh id on new item", async () => {
    const { setImages } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Add an image" }));

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

  // A brand new post starts with no images, so this is the first thing the
  // editor shows her — and it showed a bare gap. In her words, too: the
  // list's default noun would have said "No items yet" (#473, design brief
  // §3, §7).
  it("invites a first image when the post has none", () => {
    renderEditor({ images: [] });
    expect(
      screen.getByText("No images yet. Add your first one."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No items yet/)).toBeNull();
  });

  // A bare red circle beside the caption box said nothing about whether it
  // removed the caption, the photo or the post (#457, design brief §3).
  it("names what the per-image delete removes", () => {
    renderEditor();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Remove this image" }),
    ).toHaveLength(3);
  });

  it("deletes an image entry, file and all", async () => {
    const images = makeImages();
    images[1].file = new File(["img"], "pending.png", { type: "image/png" });
    const { setImages, setPost } = renderEditor({ images });

    await userEvent.click(
      screen.getAllByRole("button", { name: "Remove this image" })[1],
    );

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

  // Nothing is above the first image or below the last, so the control
  // that would say so is not drawn — the same rule every admin list has
  // followed since #457, now stated by the editor itself rather than
  // inherited from the list component it used to borrow.
  it("hides the move controls that would do nothing", () => {
    const { container } = renderEditor();
    // In document order across the three rows: the first has only "Move
    // down", the middle has both, the last has only "Move up". Read off
    // the DOM rather than per-row containers, so this pins the arrangement
    // without pinning the row's markup.
    const arrows = Array.from(
      container.querySelectorAll('button[aria-label^="Move "]'),
    ).map((button) => button.getAttribute("aria-label"));
    expect(arrows).toEqual([
      "Move down",
      "Move up",
      "Move down",
      "Move up",
    ]);
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

    fireEvent.change(screen.getAllByLabelText("Select an image")[0], {
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

    fireEvent.change(screen.getAllByLabelText("Select a different image")[0], {
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
      render(<StatefulEditor />);

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
