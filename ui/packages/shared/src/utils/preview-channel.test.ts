import { describe, expect, it } from "vitest";
import {
  PREVIEW_OVERRIDES,
  PREVIEW_QUERY_PARAM,
  PREVIEW_READY,
  isPreviewOverridesMessage,
  isPreviewReadyMessage,
} from "./preview-channel";

describe("the preview channel's message names", () => {
  // Both ends of the channel ship in separate bundles built at the same
  // time, so drift is impossible — but these strings also appear in the
  // e2e spec and in the admin iframe's `?preview=1`, which are written by
  // hand. Pinning them makes a rename a visible decision.
  it("are the namespaced values both apps agree on", () => {
    expect(PREVIEW_QUERY_PARAM).toBe("preview");
    expect(PREVIEW_READY).toBe("kari-preview-ready");
    expect(PREVIEW_OVERRIDES).toBe("kari-preview-overrides");
  });
});

describe("isPreviewReadyMessage", () => {
  it("accepts the ready signal", () => {
    expect(isPreviewReadyMessage({ type: PREVIEW_READY })).toBe(true);
  });

  it("rejects another message type", () => {
    expect(isPreviewReadyMessage({ type: PREVIEW_OVERRIDES })).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "kari-preview-ready"],
    ["undefined", undefined],
    ["a number", 7],
  ])("rejects %s, which is not a message object at all", (_name, data) => {
    expect(isPreviewReadyMessage(data)).toBe(false);
  });
});

describe("isPreviewOverridesMessage", () => {
  it("accepts an overrides message", () => {
    const message = {
      type: PREVIEW_OVERRIDES,
      overrides: { homePage: { photo: "kari.jpg", blurb: "", photoFile: null } },
    };
    expect(isPreviewOverridesMessage(message)).toBe(true);
  });

  it("accepts an empty overrides object", () => {
    // An editor with nothing to say yet still says it, rather than leaving
    // the pane showing stale drafts from a previous mount.
    expect(
      isPreviewOverridesMessage({ type: PREVIEW_OVERRIDES, overrides: {} }),
    ).toBe(true);
  });

  it("rejects the ready signal", () => {
    expect(isPreviewOverridesMessage({ type: PREVIEW_READY })).toBe(false);
  });

  it("rejects a message with no overrides payload", () => {
    expect(isPreviewOverridesMessage({ type: PREVIEW_OVERRIDES })).toBe(false);
  });

  it("rejects a non-object overrides payload", () => {
    expect(
      isPreviewOverridesMessage({ type: PREVIEW_OVERRIDES, overrides: "all" }),
    ).toBe(false);
  });

  it("rejects a value that is not a message object", () => {
    expect(isPreviewOverridesMessage(null)).toBe(false);
  });
});
