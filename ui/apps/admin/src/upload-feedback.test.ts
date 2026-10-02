import { describe, it, expect } from "vitest";
import { uploadFeedback } from "./upload-feedback";

describe("uploadFeedback", () => {
  it("narrates the sending, with the fraction as the bar, until it is all sent", () => {
    for (const fraction of [0, 0.4]) {
      expect(uploadFeedback(fraction)).toEqual({
        message: "Sending your photo to the site...",
        progress: fraction,
      });
    }
  });

  // Once every byte is up the API is still resizing, so a bar stuck at
  // 100% would read as a hang: the message moves on and the bar goes.
  it("names the resizing, with no bar, once the photo is all sent", () => {
    for (const fraction of [1, 1.2]) {
      expect(uploadFeedback(fraction)).toEqual({
        message: "Nearly there — resizing your photo for the site...",
        progress: undefined,
      });
    }
  });
});
