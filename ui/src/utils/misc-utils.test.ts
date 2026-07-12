import { describe, it, expect } from "vitest";
import { copyPhotographyPost } from "./misc-utils";
import { PhotographyPost } from "../Models";

function makePost(): PhotographyPost {
  const post = new PhotographyPost();
  post.id = "post-1";
  post.title = "A Title";
  post.subtitle = "A Subtitle";
  post.blurb = "Some blurb";
  post.images = [
    { image: "a.jpg", blurb: "first" },
    { image: "b.jpg", blurb: "second" },
  ];
  return post;
}

describe("copyPhotographyPost", () => {
  it("copies all scalar fields", () => {
    const original = makePost();
    const copy = copyPhotographyPost(original);
    expect(copy.id).toBe("post-1");
    expect(copy.title).toBe("A Title");
    expect(copy.subtitle).toBe("A Subtitle");
    expect(copy.blurb).toBe("Some blurb");
  });

  it("produces a new instance, not the same reference", () => {
    const original = makePost();
    const copy = copyPhotographyPost(original);
    expect(copy).not.toBe(original);
    expect(copy).toBeInstanceOf(PhotographyPost);
  });

  it("deep-copies the images array so edits do not leak back", () => {
    const original = makePost();
    const copy = copyPhotographyPost(original);

    expect(copy.images).toEqual(original.images);
    expect(copy.images).not.toBe(original.images);
    expect(copy.images[0]).not.toBe(original.images[0]);

    copy.images[0].blurb = "changed";
    expect(original.images[0].blurb).toBe("first");
  });

  it("handles an empty images array", () => {
    const original = makePost();
    original.images = [];
    const copy = copyPhotographyPost(original);
    expect(copy.images).toEqual([]);
  });
});
