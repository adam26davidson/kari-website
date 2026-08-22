import { describe, it, expect } from "vitest";
import {
  changeImageUrlToS3,
  changeImageUrlToApi,
  getImageFileName,
  s3ImageUrl,
  apiImageUrl,
} from "./image-management-helpers";

// VITE_API_URL / VITE_S3_URL are provided by vitest.workspace.ts test.env.
const API = "https://api.test.local";
const S3 = "https://s3.test.local";

describe("image-management-helpers", () => {
  describe("s3ImageUrl", () => {
    it("points at the original inside the image's directory", () => {
      expect(s3ImageUrl("photo.jpg")).toBe(
        `${S3}/images/photo.jpg/original.jpg`,
      );
    });

    it("lowercases the extension, as the API does when storing it", () => {
      expect(s3ImageUrl("photo.JPG")).toBe(
        `${S3}/images/photo.JPG/original.jpg`,
      );
    });

    it("omits the extension for an id that has none", () => {
      expect(s3ImageUrl("photo")).toBe(`${S3}/images/photo/original`);
    });

    it("ignores an unusable extension, as the API does", () => {
      expect(s3ImageUrl("photo.averyveryverylongextension")).toBe(
        `${S3}/images/photo.averyveryverylongextension/original`,
      );
    });
  });

  describe("apiImageUrl", () => {
    it("builds an API images url from an image id", () => {
      expect(apiImageUrl("photo.jpg")).toBe(`${API}/images/photo.jpg`);
    });

    it("asks for a variant with the size query the API accepts", () => {
      expect(apiImageUrl("photo.jpg", "thumb")).toBe(
        `${API}/images/photo.jpg?size=thumb`,
      );
    });
  });

  describe("getImageFileName", () => {
    it("reads the id out of a directory-layout S3 url", () => {
      expect(getImageFileName(`${S3}/images/photo.jpg/original.jpg`)).toBe(
        "photo.jpg",
      );
    });

    it("reads the id out of an API url carrying a size query", () => {
      expect(getImageFileName(`${API}/images/photo.jpg?size=thumb`)).toBe(
        "photo.jpg",
      );
    });

    it("ignores a fragment", () => {
      expect(getImageFileName(`${API}/images/photo.jpg#anchor`)).toBe(
        "photo.jpg",
      );
    });

    it("reads the id out of a legacy single-object url", () => {
      expect(getImageFileName(`${S3}/images/photo.jpg`)).toBe("photo.jpg");
    });

    it("falls back to the last segment when there is no images marker", () => {
      expect(getImageFileName("https://whatever/x/y/pic.png")).toBe("pic.png");
    });

    it("returns an empty id for a bare images url", () => {
      expect(getImageFileName(`${S3}/images/`)).toBe("");
    });
  });

  describe("changeImageUrlToS3", () => {
    it("rewrites an API url to the public S3 original", () => {
      expect(changeImageUrlToS3(`${API}/images/photo.jpg`)).toBe(
        `${S3}/images/photo.jpg/original.jpg`,
      );
    });

    it("leaves an already-S3 url pointing at the same object", () => {
      expect(changeImageUrlToS3(`${S3}/images/photo.jpg/original.jpg`)).toBe(
        `${S3}/images/photo.jpg/original.jpg`,
      );
    });
  });

  describe("changeImageUrlToApi", () => {
    it("rewrites a directory-layout S3 url to the API images path", () => {
      expect(changeImageUrlToApi(`${S3}/images/photo.jpg/original.jpg`)).toBe(
        `${API}/images/photo.jpg`,
      );
    });
  });
});
