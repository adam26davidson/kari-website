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
  });

  it("renders the post whose id is in the route", async () => {
    renderAt("/blog/post-1");
    expect(await screen.findByText("A Published Post")).toBeInTheDocument();
    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(BlogService.getSanitizedContentFromS3).toHaveBeenCalledWith(
      "post-1",
    );
  });
});
