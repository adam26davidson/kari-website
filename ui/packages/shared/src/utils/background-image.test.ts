import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BackgroundImageError,
  MAX_DIMENSION,
  prepareBackgroundImage,
} from "./background-image";

/** A stand-in ImageBitmap with just the members the helper uses. */
function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function fileOfSize(bytes: number, name = "photo.jpg", type = "image/jpeg") {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** The 2d context handed out by the mocked canvas. */
const drawImage = vi.fn();

/**
 * jsdom has no real canvas: getContext returns null and toBlob throws.
 * Mock both on the prototype so the helper's happy path is testable; the
 * bytes are irrelevant, only sizes and types matter.
 */
function mockCanvas(blob: Blob | null) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (callback: BlobCallback) {
      callback(blob);
    },
  );
}

function mockBitmap(width: number, height: number) {
  const bitmap = fakeBitmap(width, height);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  return bitmap;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  drawImage.mockClear();
});

describe("prepareBackgroundImage validation", () => {
  it("rejects files that are not images", async () => {
    const file = fileOfSize(100, "notes.txt", "text/plain");
    await expect(prepareBackgroundImage(file)).rejects.toThrow(
      BackgroundImageError,
    );
    await expect(prepareBackgroundImage(file)).rejects.toThrow(
      /not an image/,
    );
  });

  it("rejects files that cannot be decoded as an image", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode failed")),
    );
    const file = fileOfSize(100, "broken.png", "image/png");
    await expect(prepareBackgroundImage(file)).rejects.toThrow(
      /could not be read as an image/,
    );
  });
});

describe("prepareBackgroundImage passthrough", () => {
  it("returns a small, correctly sized image untouched", async () => {
    const bitmap = mockBitmap(1600, 1200);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const file = fileOfSize(200_000);

    const result = await prepareBackgroundImage(file);

    expect(result).toBe(file);
    expect(toBlob).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("falls back to the original when the browser cannot draw (no 2d context)", async () => {
    mockBitmap(5000, 4000);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const file = fileOfSize(200_000);

    expect(await prepareBackgroundImage(file)).toBe(file);
  });

  it("falls back to the original when encoding yields no blob", async () => {
    mockBitmap(5000, 4000);
    mockCanvas(null);
    const file = fileOfSize(200_000);

    expect(await prepareBackgroundImage(file)).toBe(file);
  });

  it("rejects an over-limit original that the browser cannot resize", async () => {
    mockBitmap(8000, 6000);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const file = fileOfSize(9_500_000);

    await expect(prepareBackgroundImage(file)).rejects.toThrow(
      /too large to upload/,
    );
  });
});

describe("prepareBackgroundImage downscaling", () => {
  it("downscales an oversized image to the maximum dimension", async () => {
    const bitmap = mockBitmap(MAX_DIMENSION * 2, MAX_DIMENSION);
    mockCanvas(new Blob([new Uint8Array(400_000)], { type: "image/webp" }));
    const file = fileOfSize(6_000_000, "huge.jpg");

    const result = await prepareBackgroundImage(file);

    expect(result.type).toBe("image/webp");
    expect(result.name).toBe("huge.webp");
    expect(result.size).toBe(400_000);
    // Drawn at half size: the long edge capped to MAX_DIMENSION.
    expect(drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      MAX_DIMENSION,
      MAX_DIMENSION / 2,
    );
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("re-encodes a heavy image that is already within the size limit", async () => {
    mockBitmap(2000, 1500);
    mockCanvas(new Blob([new Uint8Array(300_000)], { type: "image/webp" }));
    const file = fileOfSize(4_000_000);

    const result = await prepareBackgroundImage(file);

    expect(result.type).toBe("image/webp");
    expect(result.size).toBe(300_000);
  });

  it("keeps the original when a same-size re-encode would grow the file", async () => {
    // A browser without WebP support encodes to PNG, which can be larger
    // than the original JPEG.
    mockBitmap(2000, 1500);
    mockCanvas(new Blob([new Uint8Array(5_000_000)], { type: "image/png" }));
    const file = fileOfSize(4_000_000);

    expect(await prepareBackgroundImage(file)).toBe(file);
  });
});
