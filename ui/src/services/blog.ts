import { BlogPost, BlogPostContentUpdate } from "../Models";
import DOMPurify from "dompurify";

const API_BLOG_URL = import.meta.env.VITE_API_URL + "/blog";
const API_BLOG_CONTENT_URL = import.meta.env.VITE_API_URL + "/blog-content";
const S3_BLOG_LIST_URL = import.meta.env.VITE_S3_URL + "/blog-posts.json";
const S3_BLOG_CONTENT_URL = import.meta.env.VITE_S3_URL + "/blog";

export class BlogService {
  static async getListFromApi(
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<BlogPost>> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_BLOG_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error("Failed to fetch blog from API", response.status);
      console.error("error", response);
      return [];
    }
    const data: Array<BlogPost> = await response.json();
    console.log("Fetched Blog List:", data);
    return data;
  }

  static async getPublicListFromS3() {
    const response = await fetch(S3_BLOG_LIST_URL);
    if (!response.ok) {
      console.error("Failed to fetch blog from API", response.status);
      console.error("error", response);
      return [];
    }
    let data: Array<BlogPost> = await response.json();
    data = data.filter((p) => p.isPublished);
    return data;
  }

  static async updateList(
    blogList: Array<BlogPost>,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<Array<BlogPost>> {
    const token = await getAccessTokenSilently();
    const response = await fetch(API_BLOG_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(blogList),
    });
    if (!response.ok) {
      console.error("Failed to update blog list", response.status);
      console.error("error", response);
      return [];
    }
    const responseBody = await response.json();
    console.log("Saved Blog List:", responseBody);
    return responseBody;
  }

  static async getContent(
    id: string,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<string> {
    const token = await getAccessTokenSilently();
    const response = await fetch(`${API_BLOG_CONTENT_URL}/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error("Failed to fetch blog content from API", response.status);
      console.error("error", response);
      return "";
    }
    const data: { content: string } = await response.json();
    console.log("Fetched Blog Content:", data);
    return data["content"];
  }

  static async getSanitizedContentFromS3(id: string) {
    const response = await fetch(`${S3_BLOG_CONTENT_URL}/${id}.html`);
    if (!response.ok) {
      console.error("Failed to fetch blog content from S3", response.status);
      console.error("error", response);
      return "";
    }
    const content: string = await response.text();
    const sanitizedContent = DOMPurify.sanitize(content);
    return sanitizedContent;
  }

  static async updateContent(
    id: string,
    content: string,
    isPublished: boolean,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const body: BlogPostContentUpdate = { id, content, isPublished };
    const response = await fetch(`${API_BLOG_CONTENT_URL}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error("Failed to update blog content", response.status);
      console.error("error", response);
      return;
    }
    const responseBody: { content: string } = await response.json();
    console.log("Saved Blog Content:", responseBody);
  }

  static async deleteContent(
    id: string,
    getAccessTokenSilently: () => Promise<string>,
  ): Promise<void> {
    const token = await getAccessTokenSilently();
    const response = await fetch(`${API_BLOG_CONTENT_URL}/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error("Failed to delete blog content", response.status);
      console.error("error", response);
      return;
    }
  }
}
