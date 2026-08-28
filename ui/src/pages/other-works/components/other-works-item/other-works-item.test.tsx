import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
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

  it("retries a post image at the legacy key when its S3 load fails", async () => {
    // The post's HTML is injected, so React never sees these <img>s. On a
    // bucket that migrate-images has not touched, the directory-layout src
    // written at publish time 404s and the object is at images/<id>.
    vi.mocked(BlogService.getSanitizedContentFromS3).mockResolvedValue(
      '<p>Post body</p><img alt="in post" ' +
        'src="https://s3.test.local/images/photo.jpg/original.jpg">',
    );
    renderItem();

    const image = await screen.findByAltText("in post");
    // `error` does not bubble; the component listens in the capture phase.
    image.dispatchEvent(new Event("error"));

    expect(image).toHaveAttribute(
      "src",
      "https://s3.test.local/images/photo.jpg",
    );
  });

  it("shows a loading indicator while the post is being fetched", async () => {
    renderItem();
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows a not-found state for an unknown id, never Invalid Date", async () => {
    renderItem("no-such-post");

    expect(await screen.findByText("Post not found")).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to all posts" }),
    ).toHaveAttribute("href", "/other-works");
    // The content fetch is skipped entirely for unknown ids.
    expect(BlogService.getSanitizedContentFromS3).not.toHaveBeenCalled();
  });

  it("shows an error state when the content fetch fails", async () => {
    vi.mocked(BlogService.getSanitizedContentFromS3).mockRejectedValueOnce(
      new Error("Failed to fetch blog content (HTTP 500)"),
    );

    renderItem();
    expect(
      await screen.findByText("Failed to load post."),
    ).toBeInTheDocument();
    // Never a silently empty body.
    expect(screen.queryByText("A Published Post")).not.toBeInTheDocument();
  });

  it("recovers via Retry after a failed content fetch", async () => {
    vi.mocked(BlogService.getSanitizedContentFromS3).mockRejectedValueOnce(
      new Error("Failed to fetch blog content (HTTP 500)"),
    );

    renderItem();
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("Post body")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load post."),
    ).not.toBeInTheDocument();
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
