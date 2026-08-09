import { describe, it, expect } from "vitest";
import { BlogService } from "./blog";
import { BlogPost } from "../Models";
import { getToken, mockFetchOnce, setupServiceTestHooks } from "./test-helpers";

const API_BLOG_URL = "https://api.test.local/blog";
const API_BLOG_CONTENT_URL = "https://api.test.local/blog-content";
const S3_BLOG_LIST_URL = "https://s3.test.local/blog-posts.json";
const S3_BLOG_CONTENT_URL = "https://s3.test.local/blog";

const publishedPost: BlogPost = {
  id: "b1",
  title: "Hello",
  date: "2026-08-04",
  isPublished: true,
};

const draftPost: BlogPost = {
  id: "b2",
  title: "Draft",
  date: "2026-08-05",
  isPublished: false,
};

setupServiceTestHooks();

describe("BlogService.getListFromApi", () => {
  it("sends a bearer token and returns the full list including drafts", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [publishedPost, draftPost],
    });

    const result = await BlogService.getListFromApi(getToken);

    expect(result).toEqual([publishedPost, draftPost]);
    expect(fetchMock).toHaveBeenCalledWith(API_BLOG_URL, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the API responds with an error so the admin UI can block editing", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(BlogService.getListFromApi(getToken)).rejects.toThrow(
      "Failed to fetch blog list (HTTP 500)",
    );
  });
});

describe("BlogService.getPublicListFromS3", () => {
  it("fetches without a token and filters out unpublished posts", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => [publishedPost, draftPost],
    });

    const result = await BlogService.getPublicListFromS3();

    // Drafts must never leak onto the public site.
    expect(result).toEqual([publishedPost]);
    expect(fetchMock).toHaveBeenCalledWith(S3_BLOG_LIST_URL);
  });

  it("throws on a non-ok response so pages can show an error state", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(BlogService.getPublicListFromS3()).rejects.toThrow(
      "Failed to fetch blog list (HTTP 404)",
    );
  });

  it("logs the S3 fetch as the failure source, not the API", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });

    await expect(BlogService.getPublicListFromS3()).rejects.toThrow();

    expect(console.error).toHaveBeenCalledWith(
      "Failed to fetch blog from S3",
      404,
    );
  });
});

describe("BlogService.updateList", () => {
  it("PUTs the list as json with auth and content-type headers", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await BlogService.updateList([publishedPost], getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_BLOG_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify([publishedPost]),
    });
  });

  it("throws an HttpError when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    const failure = BlogService.updateList([publishedPost], getToken);
    await expect(failure).rejects.toThrow(
      "Failed to update blog list (HTTP 401)",
    );
    await expect(failure).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });
});

describe("BlogService.getContent", () => {
  it("fetches the post content by id with auth and unwraps the content field", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ content: "<p>hi</p>" }),
    });

    const result = await BlogService.getContent("b1", getToken);

    expect(result).toBe("<p>hi</p>");
    expect(fetchMock).toHaveBeenCalledWith(`${API_BLOG_CONTENT_URL}/b1`, {
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws an HttpError with the status when the fetch fails", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(BlogService.getContent("missing", getToken)).rejects.toThrow(
      "Failed to fetch blog content (HTTP 404)",
    );
  });
});

describe("BlogService.getSanitizedContentFromS3", () => {
  it("fetches the html by id and strips unsafe markup", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      text: async () => '<p>hi</p><script>alert("xss")</script>',
    });

    const result = await BlogService.getSanitizedContentFromS3("b1");

    // Stored content is rendered with dangerouslySetInnerHTML, so script
    // tags must not survive sanitization.
    expect(result).toBe("<p>hi</p>");
    expect(fetchMock).toHaveBeenCalledWith(`${S3_BLOG_CONTENT_URL}/b1.html`);
  });

  it("throws an HttpError with the status when the fetch fails", async () => {
    mockFetchOnce({ ok: false, status: 404, text: async () => "" });
    await expect(
      BlogService.getSanitizedContentFromS3("missing"),
    ).rejects.toThrow("Failed to fetch blog content (HTTP 404)");
  });
});

describe("BlogService.updateContent", () => {
  it("PUTs id, content, and publish flag as json", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await BlogService.updateContent("b1", "<p>hi</p>", false, getToken);

    expect(fetchMock).toHaveBeenCalledWith(API_BLOG_CONTENT_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        id: "b1",
        content: "<p>hi</p>",
        isPublished: false,
      }),
    });
  });

  it("throws when the update fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      BlogService.updateContent("b1", "<p>hi</p>", true, getToken),
    ).rejects.toThrow("Failed to update blog content (HTTP 500)");
  });
});

describe("BlogService.deleteContent", () => {
  it("DELETEs the post content by id with auth", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await BlogService.deleteContent("b1", getToken);

    expect(fetchMock).toHaveBeenCalledWith(`${API_BLOG_CONTENT_URL}/b1`, {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("throws when the delete fails so callers can surface the error", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(BlogService.deleteContent("b1", getToken)).rejects.toThrow(
      "Failed to delete blog content (HTTP 500)",
    );
  });
});
