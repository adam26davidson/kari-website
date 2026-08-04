import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotographyPostEditor } from "./photography-post-editor";
import { PhotographyPost } from "../../../../../Models";

function makePost(): PhotographyPost {
  const post = new PhotographyPost();
  post.id = "p1";
  post.title = "Trip";
  post.subtitle = "Coast";
  post.blurb = "Some photos";
  post.images = [
    { image: "a.jpg", blurb: "first" },
    { image: "b.jpg", blurb: "second" },
    { image: "c.jpg", blurb: "third" },
  ];
  return post;
}

function renderEditor(overrides?: {
  validate?: (post: PhotographyPost) => boolean;
}) {
  const post = makePost();
  const setPost = vi.fn();
  const setImageFiles = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const validate = overrides?.validate ?? (() => true);
  const utils = render(
    <PhotographyPostEditor
      post={post}
      setPost={setPost}
      validate={validate}
      onSave={onSave}
      onClose={onClose}
      imageFiles={[null, null, null]}
      setImageFiles={setImageFiles}
    />,
  );
  return { ...utils, post, setPost, setImageFiles, onSave, onClose };
}

function iconButton(scope: Element, icon: string): HTMLElement {
  const button = scope
    .querySelector(`svg[data-icon="${icon}"]`)
    ?.closest(".admin-icon-button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

function listItems(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll(".admin-data-list-item");
}

beforeEach(() => {
  // the image-file handler logs its bookkeeping; keep test output clean
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("PhotographyPostEditor", () => {
  it("updates the title without touching other fields", () => {
    const { setPost } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("Title"), {
      target: { value: "New Trip" },
    });
    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.title).toBe("New Trip");
    expect(updated.subtitle).toBe("Coast");
    expect(updated.images).toEqual(makePost().images);
  });

  it("updates the subtitle and blurb", () => {
    const { setPost } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("Subtitle"), {
      target: { value: "Inland" },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional blurb"), {
      target: { value: "New blurb" },
    });
    expect(setPost.mock.calls[0][0].subtitle).toBe("Inland");
    expect(setPost.mock.calls[1][0].blurb).toBe("New blurb");
  });

  it("adds an empty image entry and file slot on new item", async () => {
    const { container, setPost, setImageFiles } = renderEditor();

    await userEvent.click(iconButton(container, "plus"));

    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images).toHaveLength(4);
    expect(updated.images[3]).toEqual({ image: "", blurb: "" });
    expect(setImageFiles).toHaveBeenCalledWith([null, null, null, null]);
  });

  it("deletes an image and its file slot together", async () => {
    const { container, setPost, setImageFiles } = renderEditor();

    await userEvent.click(iconButton(listItems(container)[1], "trash"));

    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images.map((i) => i.image)).toEqual(["a.jpg", "c.jpg"]);
    expect(setImageFiles).toHaveBeenCalledWith([null, null]);
  });

  it("moves an image down one position", async () => {
    const { container, setPost } = renderEditor();

    await userEvent.click(iconButton(listItems(container)[0], "arrow-down"));

    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images.map((i) => i.image)).toEqual([
      "b.jpg",
      "a.jpg",
      "c.jpg",
    ]);
  });

  it("moves an image up one position", async () => {
    const { container, setPost } = renderEditor();

    await userEvent.click(iconButton(listItems(container)[2], "arrow-up"));

    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images.map((i) => i.image)).toEqual([
      "a.jpg",
      "c.jpg",
      "b.jpg",
    ]);
  });

  it("edits a single image's blurb", () => {
    const { setPost } = renderEditor();

    const blurbs = screen.getAllByPlaceholderText("image blurb or caption");
    fireEvent.change(blurbs[1], { target: { value: "updated caption" } });

    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images[1].blurb).toBe("updated caption");
    expect(updated.images[0].blurb).toBe("first");
  });

  it("stores a chosen file and clears the stored image name", () => {
    const { container, setPost, setImageFiles } = renderEditor();
    const file = new File(["img"], "new.png", { type: "image/png" });

    const inputs = container.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file] } });

    expect(setImageFiles).toHaveBeenCalledWith([file, null, null]);
    const updated = setPost.mock.calls[0][0] as PhotographyPost;
    expect(updated.images[0].image).toBe("");
  });

  it("saves and closes through the editor controls", async () => {
    const { container, onSave, onClose } = renderEditor();
    const controls = container.querySelector(".data-editor-item-controls");

    await userEvent.click(iconButton(controls as Element, "floppy-disk"));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(iconButton(controls as Element, "xmark"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when validation fails", () => {
    const { container } = renderEditor({ validate: () => false });
    const controls = container.querySelector(".data-editor-item-controls");
    expect(iconButton(controls as Element, "floppy-disk")).toHaveClass(
      "disabled",
    );
  });
});
