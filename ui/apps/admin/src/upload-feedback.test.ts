import { describe, it, expect, vi } from "vitest";
import { reportUploadProgress, uploadFeedback } from "./upload-feedback";

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

  it("reads as a single photo when it is the only one of its save", () => {
    const only = { index: 1, count: 1 };
    expect(uploadFeedback(0.4, only)).toEqual(uploadFeedback(0.4));
    expect(uploadFeedback(1, only)).toEqual(uploadFeedback(1));
  });

  it("counts the photos when a save sends several", () => {
    expect(uploadFeedback(0.4, { index: 1, count: 3 })).toEqual({
      message: "Sending photo 1 of 3 to the site...",
      progress: 0.4,
    });
    // "Nearly there" on photo 1 of 3 would promise more than the bar shows.
    expect(uploadFeedback(1, { index: 1, count: 3 })).toEqual({
      message: "Resizing photo 1 of 3 for the site...",
      progress: undefined,
    });
  });

  it("says nearly there only while the last of several photos resizes", () => {
    expect(uploadFeedback(1, { index: 3, count: 3 })).toEqual({
      message: "Nearly there — resizing photo 3 of 3 for the site...",
      progress: undefined,
    });
  });
});

describe("reportUploadProgress", () => {
  it("puts each step of the upload on the overlay", () => {
    const showLoading = vi.fn();
    const onProgress = reportUploadProgress(showLoading);
    onProgress(0.4);
    onProgress(1);
    expect(showLoading.mock.calls).toEqual([
      ["Sending your photo to the site...", 0.4],
      ["Nearly there — resizing your photo for the site...", undefined],
    ]);
  });

  it("passes the photo's place in the save through to the words", () => {
    const showLoading = vi.fn();
    reportUploadProgress(showLoading, { index: 2, count: 5 })(0.5);
    expect(showLoading).toHaveBeenCalledWith(
      "Sending photo 2 of 5 to the site...",
      0.5,
    );
  });
});
