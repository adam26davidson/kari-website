import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { OtherWorksItem } from "./other-works-item";
import { BlogService } from "@kari/shared/services/blog";
import { BlogPostOverride } from "@kari/shared/utils/preview-channel";
import { formatPostDate } from "@kari/shared/utils/date-helpers";
import { PreviewOverridesContext } from "../../../../preview/preview-overrides-context";

vi.mock("@kari/shared/services/blog", () => ({
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

// The admin's in-editor site preview frames /blog/:id with her unsaved post
// (#859).
describe("OtherWorksItem with a preview draft", () => {
  const draft: BlogPostOverride = {
    id: "post-1",
    title: "A Draft Title",
    date: "2026-02-03T00:00:00.000Z",
    isPublished: true,
    content: "<p>Draft body</p>",
  };

  function renderWithDraft(blogPost: BlogPostOverride, id = post.id) {
    return render(
      <PreviewOverridesContext.Provider value={{ blogPost }}>
        <MemoryRouter>
          <OtherWorksItem id={id} />
        </MemoryRouter>
      </PreviewOverridesContext.Provider>,
    );
  }

  beforeEach(() => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue([post]);
    vi.mocked(BlogService.getSanitizedContentFromS3).mockResolvedValue(
      "<p>Post body</p>",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the draft at once, with no loading state", () => {
    renderWithDraft(draft);

    expect(
      screen.getByRole("link", { name: "A Draft Title" }),
    ).toHaveAttribute("href", "/blog/post-1");
    expect(screen.getByText("Draft body")).toBeInTheDocument();
    expect(screen.getByText(formatPostDate(draft.date))).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("keeps showing the draft, not the deployed post, once the fetch lands", async () => {
    renderWithDraft(draft);

    await vi.waitFor(() =>
      expect(BlogService.getSanitizedContentFromS3).toHaveBeenCalled(),
    );
    expect(await screen.findByText("Draft body")).toBeInTheDocument();
    expect(screen.queryByText("Post body")).not.toBeInTheDocument();
    expect(screen.queryByText("A Published Post")).not.toBeInTheDocument();
  });

  it("sanitizes the draft's HTML", () => {
    const { container } = renderWithDraft({
      ...draft,
      content: '<p>ok</p><script>window.pwned = 1</script><img src="x" onerror="alert(1)">',
    });

    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  // A new post is unpublished from creation; she still needs to see it.
  it("renders an unpublished draft the published list does not have", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue([]);
    renderWithDraft({ ...draft, isPublished: false });

    expect(screen.getByText("Draft body")).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(BlogService.getPublicListFromS3).toHaveBeenCalled(),
    );
    expect(screen.queryByText("Post not found")).not.toBeInTheDocument();
  });

  it("shows the draft rather than an error when the fetch fails", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockRejectedValue(
      new Error("network down"),
    );
    renderWithDraft(draft);

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(screen.getByText("Draft body")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load post.")).not.toBeInTheDocument();
  });

  it("leaves another post's page alone", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue([]);
    renderWithDraft(draft, "some-other-post");

    expect(await screen.findByText("Post not found")).toBeInTheDocument();
    expect(screen.queryByText("Draft body")).not.toBeInTheDocument();
  });
});
