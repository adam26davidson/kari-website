import { describe, it, expect } from "vitest";
import {
  changeImageUrlToS3,
  changeImageUrlToApi,
  getImageFileName,
} from "./image-management-helpers";

// VITE_API_URL / VITE_S3_URL are provided by vitest.config.ts test.env.
const API = "https://api.test.local";
const S3 = "https://s3.test.local";

describe("image-management-helpers", () => {
  describe("changeImageUrlToS3", () => {
    it("rewrites an API url to the S3 images path", () => {
      expect(changeImageUrlToS3(`${API}/images/photo.jpg`)).toBe(
        `${S3}/images/photo.jpg`,
      );
    });

    it("uses only the final path segment as the filename", () => {
      expect(changeImageUrlToS3("https://whatever/x/y/z/pic.png")).toBe(
        `${S3}/images/pic.png`,
      );
    });
  });

  describe("changeImageUrlToApi", () => {
    it("rewrites an S3 url to the API images path", () => {
      expect(changeImageUrlToApi(`${S3}/images/photo.jpg`)).toBe(
        `${API}/images/photo.jpg`,
      );
    });
  });

  describe("getImageFileName", () => {
    it("returns the last path segment", () => {
      expect(getImageFileName("https://host/a/b/file.jpg")).toBe("file.jpg");
    });
  });

});
