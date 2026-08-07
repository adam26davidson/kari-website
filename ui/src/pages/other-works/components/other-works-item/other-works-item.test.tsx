import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OtherWorksItem } from "./other-works-item";
import { BlogService } from "../../../../services/blog";

vi.mock("../../../../services/blog", () => ({
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

function renderItem(id = post.id) {
  return render(
    <MemoryRouter>
      <OtherWorksItem id={id} />
    </MemoryRouter>,
  );
}

describe("OtherWorksItem", () => {
  beforeEach(() => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue([post]);
    vi.mocked(BlogService.getSanitizedContentFromS3).mockResolvedValue(
      "<p>Post body</p>",
    );
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the post title as a link to the post's page", async () => {
    renderItem();
    const link = await screen.findByRole("link", {
      name: "A Published Post",
    });
    expect(link).toHaveAttribute("href", "/blog/post-1");
  });

  it("renders the sanitized post content", async () => {
    renderItem();
    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(BlogService.getSanitizedContentFromS3).toHaveBeenCalledWith(
      "post-1",
    );
  });

  it("shows an error state when the list fetch fails", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderItem();
    expect(
      await screen.findByText("Failed to load post."),
    ).toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderItem();
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load post."),
    ).not.toBeInTheDocument();
  });
});
