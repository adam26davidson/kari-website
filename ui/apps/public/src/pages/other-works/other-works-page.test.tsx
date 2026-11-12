import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { OtherWorksPage } from "./other-works-page";
import { BlogService } from "@kari/shared/services/blog";
import { BlogPostOverride } from "@kari/shared/utils/preview-channel";
import { PreviewOverridesContext } from "../../preview/preview-overrides-context";

vi.mock("@kari/shared/services/blog", () => ({
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

function renderPage(blogPost?: BlogPostOverride) {
  return render(
    <PreviewOverridesContext.Provider value={{ blogPost }}>
      <MemoryRouter>
        <OtherWorksPage />
      </MemoryRouter>
    </PreviewOverridesContext.Provider>,
  );
}

describe("OtherWorksPage", () => {
  beforeEach(() => {
    vi.mocked(BlogService.getPublicListFromS3).mockResolvedValue(posts);
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("shows an error state instead of a permanent spinner when the fetch fails", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();
    expect(
      await screen.findByText("Failed to load posts."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(BlogService.getPublicListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();
    await userEvent.click(await screen.findByText("Retry"));

    expect(
      await screen.findByRole("link", { name: "First Post" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load posts."),
    ).not.toBeInTheDocument();
    expect(BlogService.getPublicListFromS3).toHaveBeenCalledTimes(2);
  });

  // The admin's in-editor site preview (#1053): the list a click away from
  // the framed /blog/:id must agree with the draft it shows.
  it("shows the admin's unsaved title in place of the deployed one", async () => {
    renderPage({ ...posts[0], title: "Draft Title", content: "<p>x</p>" });

    const draft = await screen.findByRole("link", { name: "Draft Title" });
    expect(draft).toHaveAttribute("href", "/blog/post-1");
    expect(
      screen.queryByRole("link", { name: "First Post" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Second Post" }),
    ).toBeInTheDocument();
  });

  // A new post is unpublished from creation, and the deployed list drops
  // unpublished posts; the pane still shows it, as OtherWorksItem does.
  it("lists an unpublished draft the deployed list does not have", async () => {
    renderPage({
      id: "post-3",
      title: "Unpublished Draft",
      date: "2026-03-01T00:00:00.000Z",
      isPublished: false,
      content: "",
    });

    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "First Post",
      "Second Post",
      "Unpublished Draft",
    ]);
  });
});
