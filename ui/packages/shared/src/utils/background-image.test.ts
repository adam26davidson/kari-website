import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BackgroundImageError,
  MAX_UPLOAD_BYTES,
  validateBackgroundImage,
} from "./background-image";

/** A stand-in ImageBitmap with just the members the helper uses. */
function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function fileOfSize(bytes: number, name = "photo.jpg", type = "image/jpeg") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function mockBitmap(width: number, height: number) {
  const bitmap = fakeBitmap(width, height);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  return bitmap;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("validateBackgroundImage", () => {
  it("rejects files that are not images", async () => {
    const file = fileOfSize(100, "notes.txt", "text/plain");
    await expect(validateBackgroundImage(file)).rejects.toThrow(
      BackgroundImageError,
    );
    await expect(validateBackgroundImage(file)).rejects.toThrow(
      /not an image/,
    );
  });

  it("rejects files that cannot be decoded as an image", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode failed")),
    );
    const file = fileOfSize(100, "broken.png", "image/png");
    await expect(validateBackgroundImage(file)).rejects.toThrow(
      /could not be read as an image/,
    );
  });

  it("rejects a file the API's body limit would refuse", async () => {
    mockBitmap(8000, 6000);
    const file = fileOfSize(MAX_UPLOAD_BYTES + 1);

    await expect(validateBackgroundImage(file)).rejects.toThrow(
      /too big to upload/,
    );
  });

  it("accepts a huge camera original without touching a canvas", async () => {
    // The point of #453: the browser no longer resizes, so an original well
    // past the old MAX_DIMENSION passes straight through to the upload.
    const bitmap = mockBitmap(6000, 4000);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const file = fileOfSize(5_000_000, "huge.jpg");

    await expect(validateBackgroundImage(file)).resolves.toBeUndefined();

    expect(toBlob).not.toHaveBeenCalled();
    // The decoded pixels are released as soon as they have proved readable.
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("accepts a file exactly on the upload limit", async () => {
    mockBitmap(2000, 1500);
    await expect(
      validateBackgroundImage(fileOfSize(MAX_UPLOAD_BYTES)),
    ).resolves.toBeUndefined();
  });
});
