import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BlogPostPage } from "./blog-post-page";
import { BlogService } from "../../services/blog";

vi.mock("../../services/blog", () => ({
  BlogService: {
    getPublicListFromS3: vi.fn(),
    getSanitizedContentFromS3: vi.fn(),
  },
}));

const post = {
  id: "post-1",
  title: "A Published Post",
  date: "2026-01-01T00:00:00.000Z",
  isPublished: true,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="blog/:id" element={<BlogPostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BlogPostPage", () => {
  beforeEach(() => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue([post]);
    vi.mocked(BlogService.getSanitizedContentFromS3).mockResolvedValue(
      "<p>Post body</p>",
    );
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the post whose id is in the route", async () => {
    renderAt("/blog/post-1");
    expect(await screen.findByText("A Published Post")).toBeInTheDocument();
    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(BlogService.getSanitizedContentFromS3).toHaveBeenCalledWith(
      "post-1",
    );
  });

  it("renders the post inside the public list card (#410)", async () => {
    // Without the card the post sits directly on the background photo and
    // is illegible wherever the photo is dark.
    const { container } = renderAt("/blog/post-1");
    await screen.findByText("A Published Post");
    const card = container.querySelector(".data-list");
    expect(card).not.toBeNull();
    expect(card).toContainElement(screen.getByText("A Published Post"));
  });

  it("shows a loading indicator on first paint", async () => {
    renderAt("/blog/post-1");
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows a not-found state for an unknown id, never Invalid Date", async () => {
    renderAt("/blog/no-such-post");

    expect(await screen.findByText("Post not found")).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });

  it("shows the error state with retry when the content fetch fails", async () => {
    vi.mocked(BlogService.getSanitizedContentFromS3).mockRejectedValueOnce(
      new Error("Failed to fetch blog content (HTTP 500)"),
    );

    renderAt("/blog/post-1");

    expect(
      await screen.findByText("Failed to load post."),
    ).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
