import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE,
  UploadTooLargeError,
  uploadSizeProblem,
} from "./upload-size";

/** A File that reports `bytes` without allocating them. */
function fileReporting(bytes: number) {
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

describe("uploadSizeProblem", () => {
  it("accepts a file exactly on the upload limit", () => {
    expect(uploadSizeProblem(fileReporting(MAX_UPLOAD_BYTES))).toBeNull();
  });

  it("accepts a DSLR-sized original", () => {
    expect(uploadSizeProblem(fileReporting(20_000_000))).toBeNull();
  });

  it("explains, in plain words, a file the API's body limit would refuse", () => {
    const problem = uploadSizeProblem(fileReporting(MAX_UPLOAD_BYTES + 1));
    expect(problem).toMatch(/too big to upload/);
    // What to do next, not just what went wrong (design brief §5).
    expect(problem).toMatch(/pick a smaller one/);
  });

  it("names the real ceiling when it refuses a file", () => {
    // The number in the message is derived from MAX_UPLOAD_BYTES; pinning it
    // here catches the copy drifting away from the limit again.
    expect(uploadSizeProblem(fileReporting(MAX_UPLOAD_BYTES + 1))).toMatch(
      /over 25 MB/,
    );
  });

  it("stays below the API's 25 MiB request-body cap", () => {
    // api/src/routes/mod.rs: RequestBodyLimitLayer::new(25 * 1024 * 1024).
    // The multipart framing needs headroom on top of the file itself.
    expect(MAX_UPLOAD_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe("UploadTooLargeError", () => {
  it("refuses in the same words whether the browser or the site turned the photo away", () => {
    const error = new UploadTooLargeError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UploadTooLargeError");
    expect(error.message).toBe(UPLOAD_TOO_LARGE_MESSAGE);
    expect(error.message).toMatch(/too big to upload/);
    // The same advice the pick-time check gives (design brief §5).
    expect(error.message).toMatch(/pick a smaller one/);
  });

  it("does not claim a figure the server did not confirm", () => {
    // A 413 may come from a proxy ceiling below MAX_UPLOAD_BYTES, so the
    // message names neither "25 MB" nor the status code.
    expect(UPLOAD_TOO_LARGE_MESSAGE).not.toMatch(/\d/);
  });
});
