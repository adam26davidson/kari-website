import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OtherWorksPage } from "./other-works-page";
import { BlogService } from "../../services/blog";

vi.mock("../../services/blog", () => ({
  BlogService: {
    getPublicListFromS3: vi.fn(),
    getSanitizedContentFromS3: vi.fn(),
  },
}));

const posts = [
  {
    id: "post-1",
    title: "First Post",
    date: "2026-01-01T00:00:00.000Z",
    isPublished: true,
  },
  {
    id: "post-2",
    title: "Second Post",
    date: "2026-02-01T00:00:00.000Z",
    isPublished: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <OtherWorksPage />
    </MemoryRouter>,
  );
}

describe("OtherWorksPage", () => {
  beforeEach(() => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue(posts);
  });

  it("renders a summary per post linking to its /blog/:id page", async () => {
    renderPage();
    const first = await screen.findByRole("link", { name: "First Post" });
    expect(first).toHaveAttribute("href", "/blog/post-1");
    const second = await screen.findByRole("link", { name: "Second Post" });
    expect(second).toHaveAttribute("href", "/blog/post-2");
  });

  it("fetches the list once and never fetches post content", async () => {
    renderPage();
    await screen.findByRole("link", { name: "First Post" });
    expect(BlogService.getPublicListFromS3).toHaveBeenCalledTimes(1);
    expect(BlogService.getSanitizedContentFromS3).not.toHaveBeenCalled();
  });
});
