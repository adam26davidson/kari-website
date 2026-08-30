import { BlogPost, BlogPostContentUpdate } from "../models";
import DOMPurify from "dompurify";
import { TokenGetter, authorizedFetch, ensureOk } from "./http";

const API_BLOG_URL = import.meta.env.VITE_API_URL + "/blog";
const API_BLOG_CONTENT_URL = import.meta.env.VITE_API_URL + "/blog-content";
const S3_BLOG_LIST_URL = import.meta.env.VITE_S3_URL + "/blog-posts.json";
const S3_BLOG_CONTENT_URL = import.meta.env.VITE_S3_URL + "/blog";

export class BlogService {
  static async getListFromApi(
    getAccessTokenSilently: TokenGetter,
  ): Promise<Array<BlogPost>> {
    const response = await authorizedFetch(
      API_BLOG_URL,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch blog list",
      "Failed to fetch blog from API",
    );
    const data: Array<BlogPost> = await response.json();
    return data;
  }

  static async getPublicListFromS3(): Promise<Array<BlogPost>> {
    const response = await fetch(S3_BLOG_LIST_URL);
    // Throw instead of returning [] so an S3 outage is never mistaken
    // for a legitimately empty page.
    ensureOk(
      response,
      "Failed to fetch blog list",
      "Failed to fetch blog from S3",
    );
    let data: Array<BlogPost> = await response.json();
    data = data.filter((p) => p.isPublished);
    return data;
  }

  static async updateList(
    blogList: Array<BlogPost>,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      API_BLOG_URL,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(blogList),
      },
    );
    ensureOk(response, "Failed to update blog list");
  }

  static async getContent(
    id: string,
    getAccessTokenSilently: TokenGetter,
  ): Promise<string> {
    const response = await authorizedFetch(
      `${API_BLOG_CONTENT_URL}/${id}`,
      getAccessTokenSilently,
    );
    ensureOk(
      response,
      "Failed to fetch blog content",
      "Failed to fetch blog content from API",
    );
    const data: { content: string } = await response.json();
    return data["content"];
  }

  static async getSanitizedContentFromS3(id: string) {
    const response = await fetch(`${S3_BLOG_CONTENT_URL}/${id}.html`);
    // Throw instead of returning "" so a failed content fetch is never
    // mistaken for a legitimately empty post body.
    ensureOk(
      response,
      "Failed to fetch blog content",
      "Failed to fetch blog content from S3",
    );
    const content: string = await response.text();
    const sanitizedContent = DOMPurify.sanitize(content);
    return sanitizedContent;
  }

  static async updateContent(
    id: string,
    content: string,
    isPublished: boolean,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const body: BlogPostContentUpdate = { id, content, isPublished };
    const response = await authorizedFetch(
      `${API_BLOG_CONTENT_URL}`,
      getAccessTokenSilently,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    ensureOk(response, "Failed to update blog content");
  }

  static async deleteContent(
    id: string,
    getAccessTokenSilently: TokenGetter,
  ): Promise<void> {
    const response = await authorizedFetch(
      `${API_BLOG_CONTENT_URL}/${id}`,
      getAccessTokenSilently,
      { method: "DELETE" },
    );
    ensureOk(response, "Failed to delete blog content");
  }
}
