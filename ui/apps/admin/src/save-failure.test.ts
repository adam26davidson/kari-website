import { describe, it, expect } from "vitest";
import { HttpError } from "@kari/shared/services/http-error";
import { BackgroundImageError } from "@kari/shared/utils/background-image";
import {
  UPLOAD_TOO_LARGE_MESSAGE,
  UploadTooLargeError,
} from "@kari/shared/utils/upload-size";
import { SAVE_FAILED_MESSAGE, saveFailureMessage } from "./save-failure";

const FALLBACK = "Failed to save haiga image";

describe("saveFailureMessage", () => {
  it("tells her the photo was too big, whatever the page's fallback", () => {
    expect(saveFailureMessage(new UploadTooLargeError(), FALLBACK)).toBe(
      UPLOAD_TOO_LARGE_MESSAGE,
    );
  });

  it("shows a background-photo problem in its own words", () => {
    const error = new BackgroundImageError("That file isn't a photo.");
    expect(saveFailureMessage(error, FALLBACK)).toBe(
      "That file isn't a photo.",
    );
  });

  it("falls back for errors whose message is not meant for her", () => {
    expect(saveFailureMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
    expect(
      saveFailureMessage(
        new HttpError("Failed to upload image (HTTP 500)", 500),
        FALLBACK,
      ),
    ).toBe(FALLBACK);
    expect(saveFailureMessage("not even an Error", FALLBACK)).toBe(FALLBACK);
  });

  it("falls back to the editors' save-failed message by default", () => {
    expect(saveFailureMessage(new Error("boom"))).toBe(SAVE_FAILED_MESSAGE);
  });
});
