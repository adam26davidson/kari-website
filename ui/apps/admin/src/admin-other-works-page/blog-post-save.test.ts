import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BlogPostSaveDeps,
  ROLLBACK_INCOMPLETE_MESSAGE,
  SaveBlogPostArgs,
  planContentSave,
  saveBlogPost,
} from "./blog-post-save";
import { BlogPost } from "../../../models";

const apiImg = (id: string) => `https://api.test.local/images/${id}`;
// Public URLs name the original inside the image's own directory (#273).
const s3Img = (id: string) => {
  const extension = /\.[a-zA-Z0-9]+$/.exec(id)?.[0].toLowerCase() ?? "";
  return `https://s3.test.local/images/${id}/original${extension}`;
};
const img = (src: string, title?: string) =>
  `<img src="${src}"${title ? ` title="${title}"` : ""}>`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("planContentSave image diffing", () => {
  it("classifies kept and added images", () => {
    const original = img(apiImg("removed.png")) + img(apiImg("kept.png"));
    const added = "data:image/png;base64,AAAA";
    const plan = planContentSave(
      original,
      img(apiImg("kept.png")) + img(added, "pending-1"),
      "none",
    );

    // No flip: kept images need no visibility work and no rewrite. The
    // dropped image simply falls out of the plan — its object is left
    // for the image-cleanup sweep.
    expect(plan.keptImageFileNames).toEqual([]);
    expect(plan.addedImages.map((i) => i.src)).toEqual([added]);
    expect(plan.doc.body.innerHTML).toBe(
      img(apiImg("kept.png")) + img(added, "pending-1"),
    );
  });

  it("keeps a moved added image identified by its img, not its position", () => {
    const added = "data:image/png;base64,AAAA";
    // The pending image was attached at the end, then moved to the front.
    const plan = planContentSave(
      img(apiImg("kept.png")),
      img(added, "pending-1") + img(apiImg("kept.png")),
      "none",
    );

    expect(plan.addedImages).toHaveLength(1);
    expect(plan.addedImages[0].title).toBe("pending-1");
    // Patching the added img (as the upload pass does) lands the new src
    // in the moved-to position.
    plan.addedImages[0].src = apiImg("uploaded.png");
    expect(plan.doc.body.innerHTML).toBe(
      img(apiImg("uploaded.png"), "pending-1") + img(apiImg("kept.png")),
    );
  });

  it("rewrites kept images to S3 urls when publishing", () => {
    const original = img(apiImg("a.png")) + img(apiImg("b.png"));
    const plan = planContentSave(original, original, "publishing");

    expect(plan.keptImageFileNames).toEqual(["a.png", "b.png"]);
    expect(plan.doc.body.innerHTML).toBe(
      img(s3Img("a.png")) + img(s3Img("b.png")),
    );
  });

  it("rewrites kept images to API urls when unpublishing", () => {
    const original = img(s3Img("a.png"));
    const plan = planContentSave(original, original, "unpublishing");

    expect(plan.keptImageFileNames).toEqual(["a.png"]);
    expect(plan.doc.body.innerHTML).toBe(img(apiImg("a.png")));
  });

  it("rewrites but does not flip a kept image whose src has no file name", () => {
    const original = img(apiImg("a.png")) + img(apiImg(""));
    const plan = planContentSave(original, original, "publishing");

    // No file name means its visibility cannot be flipped, but the src
    // still moves to the destination host with the others.
    expect(plan.keptImageFileNames).toEqual(["a.png"]);
    expect(plan.doc.body.innerHTML).toBe(img(s3Img("a.png")) + img(s3Img("")));
    expect(console.error).toHaveBeenCalledWith(
      `File name not found for image: ${apiImg("")}`,
    );
  });

  it("does not rewrite or flip an image removed while publishing", () => {
    const plan = planContentSave(
      img(apiImg("kept.png")) + img(apiImg("removed.png")),
      img(apiImg("kept.png")),
      "publishing",
    );

    // The dropped image is no longer referenced — it must not join the
    // kept flips.
    expect(plan.keptImageFileNames).toEqual(["kept.png"]);
    expect(plan.doc.body.innerHTML).toBe(img(s3Img("kept.png")));
  });

  it("pairs same-src duplicates one-to-one when rewriting", () => {
    const original = img(apiImg("dup.png")) + img(apiImg("dup.png"));
    const plan = planContentSave(original, original, "publishing");

    // Both copies are rewritten (each original consumes its own new img
    // from the src index), and both flips are collected.
    expect(plan.keptImageFileNames).toEqual(["dup.png", "dup.png"]);
    expect(plan.doc.body.innerHTML).toBe(
      img(s3Img("dup.png")) + img(s3Img("dup.png")),
    );
  });
});

describe("saveBlogPost transaction outcomes", () => {
  let post: BlogPost;

  function makeDeps(): BlogPostSaveDeps {
    return {
      getToken: async () => "token",
      updateContent: vi.fn().mockResolvedValue(undefined),
      uploadImage: vi.fn().mockResolvedValue("uploaded.png"),
      setImagePublished: vi.fn().mockResolvedValue(undefined),
      saveList: vi.fn().mockResolvedValue(true),
      restoreList: vi.fn().mockResolvedValue(undefined),
      showLoading: vi.fn(),
      notify: vi.fn(),
    };
  }

  function makeArgs(
    deps: BlogPostSaveDeps,
    overrides?: Partial<Omit<SaveBlogPostArgs, "deps" | "post">> & {
      post?: Partial<BlogPost>;
    },
  ): SaveBlogPostArgs {
    const { post: postOverrides, ...rest } = overrides ?? {};
    post = {
      id: "b1",
      title: "A Post",
      date: "2024-05-01T00:00:00.000Z",
      isPublished: false,
      ...postOverrides,
    };
    return {
      post,
      wasPublished: false,
      newPostList: [post],
      originalContent: "<p>hello</p>",
      newContent: "<p>edited</p>",
      pendingImageFiles: new Map(),
      deps,
      ...rest,
    };
  }

  beforeEach(() => {
    post = undefined as unknown as BlogPost;
  });

  describe("no-flip saves", () => {
    it("saves content then list, leaving removed images in storage", async () => {
      const deps = makeDeps();
      const result = await saveBlogPost(
        makeArgs(deps, { originalContent: img(apiImg("old.png")) }),
      );

      // The dropped image's object is left for the image-cleanup sweep —
      // it may still be referenced elsewhere (e.g. as the site
      // background).
      expect(result).toEqual({ outcome: "saved", rollbackIncomplete: false });
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        "<p>edited</p>",
        false,
        deps.getToken,
      );
      expect(deps.saveList).toHaveBeenCalledWith([post]);
      expect(
        vi.mocked(deps.updateContent).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(deps.saveList).mock.invocationCallOrder[0]);
      expect(deps.notify).toHaveBeenCalledWith("Other works item saved");
    });

    it("saves empty content when the editor holds none", async () => {
      const deps = makeDeps();
      const result = await saveBlogPost(makeArgs(deps, { newContent: null }));

      expect(result.outcome).toBe("saved");
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        "",
        false,
        deps.getToken,
      );
    });

    it("fails without touching the list when the content save fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.updateContent).mockRejectedValue(new Error("PUT failed"));
      const result = await saveBlogPost(makeArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: false });
      expect(deps.saveList).not.toHaveBeenCalled();
      expect(deps.notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      );
    });

    it("reports rolledBack without its own toast when the list save fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.saveList).mockResolvedValue(false);
      const result = await saveBlogPost(makeArgs(deps));

      // saveList already toasted; the module adds nothing.
      expect(result).toEqual({
        outcome: "rolledBack",
        rollbackIncomplete: false,
      });
      expect(deps.notify).not.toHaveBeenCalled();
    });
  });

  describe("image uploads", () => {
    it("uploads the pending file behind an added img and patches its src", async () => {
      const deps = makeDeps();
      const file = new File(["img"], "fresh.png", { type: "image/png" });
      const result = await saveBlogPost(
        makeArgs(deps, {
          originalContent: "",
          newContent: img("data:image/png;base64,AAAA", "pending-1"),
          pendingImageFiles: new Map([["pending-1", file]]),
        }),
      );

      expect(result.outcome).toBe("saved");
      expect(deps.uploadImage).toHaveBeenCalledWith(file, false, deps.getToken);
      // Unpublished post: the patched src uses the API host.
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        img(apiImg("uploaded.png"), "pending-1"),
        false,
        deps.getToken,
      );
    });

    it("patches an added img with the S3 original url when publishing", async () => {
      // A published post's content is read straight from S3, so a freshly
      // uploaded image must be referenced by its stored key, not by an id
      // the bucket has no object for.
      const deps = makeDeps();
      const result = await saveBlogPost(
        makeArgs(deps, {
          post: { isPublished: true },
          wasPublished: true,
          originalContent: "",
          newContent: img("data:image/png;base64,AAAA", "pending-1"),
          pendingImageFiles: new Map([
            ["pending-1", new File(["img"], "fresh.png")],
          ]),
        }),
      );

      expect(result.outcome).toBe("saved");
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        img(s3Img("uploaded.png"), "pending-1"),
        true,
        deps.getToken,
      );
    });

    it("aborts before the transaction when an upload resolves empty", async () => {
      const deps = makeDeps();
      vi.mocked(deps.uploadImage).mockResolvedValue(null);
      const result = await saveBlogPost(
        makeArgs(deps, {
          originalContent: "",
          newContent: img("data:image/png;base64,AAAA", "pending-1"),
          pendingImageFiles: new Map([
            ["pending-1", new File(["img"], "fresh.png")],
          ]),
        }),
      );

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: false });
      expect(deps.updateContent).not.toHaveBeenCalled();
      expect(deps.saveList).not.toHaveBeenCalled();
      expect(deps.notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      );
    });
  });

  describe("publishing", () => {
    const draft = img(apiImg("a.png")) + img(apiImg("b.png"));

    function publishArgs(deps: BlogPostSaveDeps): SaveBlogPostArgs {
      return makeArgs(deps, {
        post: { isPublished: true },
        wasPublished: false,
        originalContent: draft,
        newContent: draft,
      });
    }

    it("flips images public, saves content, then commits via the list", async () => {
      const deps = makeDeps();
      const result = await saveBlogPost(publishArgs(deps));

      expect(result).toEqual({ outcome: "saved", rollbackIncomplete: false });
      expect(vi.mocked(deps.setImagePublished).mock.calls).toEqual([
        ["a.png", true, deps.getToken],
        ["b.png", true, deps.getToken],
      ]);
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        img(s3Img("a.png")) + img(s3Img("b.png")),
        true,
        deps.getToken,
      );
      const lastFlip = vi.mocked(deps.setImagePublished).mock
        .invocationCallOrder[1];
      const contentOrder = vi.mocked(deps.updateContent).mock
        .invocationCallOrder[0];
      const listOrder = vi.mocked(deps.saveList).mock.invocationCallOrder[0];
      expect(lastFlip).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(listOrder);
    });

    it("marks the rollback incomplete when a failed flip cannot be unflipped", async () => {
      const deps = makeDeps();
      vi.mocked(deps.setImagePublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && isPublished) {
            throw new Error("flip failed");
          }
          if (fileName === "a.png" && !isPublished) {
            throw new Error("unflip failed");
          }
        },
      );
      const result = await saveBlogPost(publishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: true });
      expect(deps.notify).toHaveBeenCalledWith(
        ROLLBACK_INCOMPLETE_MESSAGE,
        "error",
      );
      expect(deps.updateContent).not.toHaveBeenCalled();
    });

    it("marks the rollback incomplete when unflipping after a content failure fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.updateContent).mockRejectedValue(new Error("PUT failed"));
      vi.mocked(deps.setImagePublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "a.png" && !isPublished) {
            throw new Error("unflip failed");
          }
        },
      );
      const result = await saveBlogPost(publishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: true });
      expect(deps.notify).toHaveBeenCalledWith(
        ROLLBACK_INCOMPLETE_MESSAGE,
        "error",
      );
      expect(deps.saveList).not.toHaveBeenCalled();
    });

    it("rolls back cleanly when the committing list save fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.saveList).mockResolvedValue(false);
      const result = await saveBlogPost(publishArgs(deps));

      expect(result).toEqual({
        outcome: "rolledBack",
        rollbackIncomplete: false,
      });
      // Draft content restored, both images flipped back private; only
      // saveList's own toast fired.
      expect(vi.mocked(deps.updateContent).mock.calls[1]).toEqual([
        "b1",
        draft,
        false,
        deps.getToken,
      ]);
      expect(vi.mocked(deps.setImagePublished).mock.calls.slice(2)).toEqual([
        ["a.png", false, deps.getToken],
        ["b.png", false, deps.getToken],
      ]);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("reports an incomplete rollback when the list-failure rollback fails too", async () => {
      const deps = makeDeps();
      vi.mocked(deps.saveList).mockResolvedValue(false);
      vi.mocked(deps.updateContent)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("rollback PUT failed"));
      const result = await saveBlogPost(publishArgs(deps));

      expect(result).toEqual({
        outcome: "rolledBack",
        rollbackIncomplete: true,
      });
      expect(deps.notify).toHaveBeenCalledWith(
        ROLLBACK_INCOMPLETE_MESSAGE,
        "error",
      );
    });
  });

  describe("unpublishing", () => {
    const published = img(s3Img("a.png")) + img(s3Img("b.png"));

    function unpublishArgs(deps: BlogPostSaveDeps): SaveBlogPostArgs {
      return makeArgs(deps, {
        post: { isPublished: false },
        wasPublished: true,
        originalContent: published,
        newContent: published,
      });
    }

    it("hides the post, saves content, then flips images private", async () => {
      const deps = makeDeps();
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({ outcome: "saved", rollbackIncomplete: false });
      const listOrder = vi.mocked(deps.saveList).mock.invocationCallOrder[0];
      const contentOrder = vi.mocked(deps.updateContent).mock
        .invocationCallOrder[0];
      const firstFlip = vi.mocked(deps.setImagePublished).mock
        .invocationCallOrder[0];
      expect(listOrder).toBeLessThan(contentOrder);
      expect(contentOrder).toBeLessThan(firstFlip);
      expect(deps.updateContent).toHaveBeenCalledWith(
        "b1",
        img(apiImg("a.png")) + img(apiImg("b.png")),
        false,
        deps.getToken,
      );
    });

    it("aborts untouched when hiding the post fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.saveList).mockResolvedValue(false);
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({
        outcome: "rolledBack",
        rollbackIncomplete: false,
      });
      expect(deps.updateContent).not.toHaveBeenCalled();
      expect(deps.setImagePublished).not.toHaveBeenCalled();
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("restores the list when the content save fails", async () => {
      const deps = makeDeps();
      vi.mocked(deps.updateContent).mockRejectedValue(new Error("PUT failed"));
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: false });
      expect(deps.restoreList).toHaveBeenCalledOnce();
      expect(deps.notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      );
    });

    it("marks the rollback incomplete when the list restore fails too", async () => {
      const deps = makeDeps();
      vi.mocked(deps.updateContent).mockRejectedValue(new Error("PUT failed"));
      vi.mocked(deps.restoreList).mockRejectedValue(
        new Error("rollback PUT failed"),
      );
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: true });
      expect(deps.notify).toHaveBeenCalledWith(
        ROLLBACK_INCOMPLETE_MESSAGE,
        "error",
      );
    });

    it("skips the list restore when the content restore fails first", async () => {
      // A mid-loop flip failure rolls the whole unpublish back; the
      // content and list restores share one try, so a content-restore
      // failure skips the list restore and marks the rollback incomplete.
      const deps = makeDeps();
      vi.mocked(deps.setImagePublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && !isPublished) {
            throw new Error("flip failed");
          }
        },
      );
      vi.mocked(deps.updateContent)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("rollback PUT failed"));
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: true });
      expect(deps.restoreList).not.toHaveBeenCalled();
      // a.png had gone private and was flipped back public first.
      expect(vi.mocked(deps.setImagePublished).mock.calls).toEqual([
        ["a.png", false, deps.getToken],
        ["b.png", false, deps.getToken],
        ["a.png", true, deps.getToken],
      ]);
      expect(deps.notify).toHaveBeenCalledWith(
        ROLLBACK_INCOMPLETE_MESSAGE,
        "error",
      );
    });

    it("rolls back content and list when a flip fails and restores succeed", async () => {
      const deps = makeDeps();
      vi.mocked(deps.setImagePublished).mockImplementation(
        async (fileName, isPublished) => {
          if (fileName === "b.png" && !isPublished) {
            throw new Error("flip failed");
          }
        },
      );
      const result = await saveBlogPost(unpublishArgs(deps));

      expect(result).toEqual({ outcome: "failed", rollbackIncomplete: false });
      // Published content restored, then the published list.
      expect(vi.mocked(deps.updateContent).mock.calls[1]).toEqual([
        "b1",
        published,
        true,
        deps.getToken,
      ]);
      expect(deps.restoreList).toHaveBeenCalledOnce();
      expect(deps.notify).toHaveBeenCalledWith(
        "Failed to save other works item",
        "error",
      );
    });
  });
});
