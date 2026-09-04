import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlogPostEditor } from "./blog-post-editor";
import { BlogPost } from "@kari/shared/models";
import {
  applyTimeZone,
  restoreHostTimeZoneAfterEach,
} from "@kari/shared/test/timezone";

// The rich-text editor pulls in the whole tiptap stack; stub it with a
// plain textarea so the tests exercise only BlogPostEditor's own logic.
vi.mock("../../../components/tiptap/tiptap", () => ({
  Tiptap: ({
    content,
    setContent,
  }: {
    content: string;
    setContent: (content: string | null) => void;
  }) => (
    <textarea
      placeholder="post content"
      value={content}
      onChange={(e) => setContent(e.target.value)}
    />
  ),
}));

const post: BlogPost = {
  id: "b1",
  title: "A Post",
  date: "2024-05-01T00:00:00.000Z",
  isPublished: false,
};

function renderEditor(overrides?: { post?: BlogPost; saveDisabled?: boolean }) {
  const setPost = vi.fn();
  const setContent = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <BlogPostEditor
      post={overrides?.post ?? post}
      content="<p>hello</p>"
      setContent={setContent}
      setPost={setPost}
      saveDisabled={overrides?.saveDisabled ?? false}
      onSave={onSave}
      onClose={onClose}
      onAddImage={vi.fn()}
    />,
  );
  return { ...utils, setPost, setContent, onSave, onClose };
}

describe("BlogPostEditor", () => {
  it("updates the title while keeping the rest of the post", () => {
    const { setPost } = renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New Title" },
    });
    expect(setPost).toHaveBeenCalledWith({ ...post, title: "New Title" });
  });

  it("shows the post date and stores edits as an ISO timestamp", () => {
    const { container, setPost } = renderEditor();
    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).toHaveValue("2024-05-01");

    fireEvent.change(dateInput as HTMLInputElement, {
      target: { value: "2025-01-15" },
    });
    expect(setPost).toHaveBeenCalledWith({
      ...post,
      date: "2025-01-15T00:00:00.000Z",
    });
  });

  describe("the date it stores", () => {
    restoreHostTimeZoneAfterEach();

    it("is UTC midnight of the picked day, west of UTC", () => {
      // Stored dates are read back as plain UTC calendar days (#379), so
      // the author's zone must not leak into what is written — an author
      // in Los Angeles picking Jan 1 stores Jan 1, not Dec 31.
      applyTimeZone("America/Los_Angeles");
      const { setPost } = renderEditor();
      fireEvent.change(
        screen.getByDisplayValue("2024-05-01") as HTMLInputElement,
        { target: { value: "2026-01-01" } },
      );
      expect(setPost).toHaveBeenCalledWith({
        ...post,
        date: "2026-01-01T00:00:00.000Z",
      });
    });
  });

  it("ignores clearing the date instead of crashing on Invalid Date", () => {
    const { container, setPost } = renderEditor();
    const dateInput = container.querySelector('input[type="date"]');

    // Clearing the input fires a change with "" — new Date("") is an
    // Invalid Date whose toISOString() would throw (#154). The change is
    // ignored, so post.date keeps its last valid value.
    fireEvent.change(dateInput as HTMLInputElement, {
      target: { value: "" },
    });

    expect(setPost).not.toHaveBeenCalled();
    expect(dateInput).toHaveValue("2024-05-01");
  });

  it("renders a malformed stored date as an empty date input", () => {
    const { container } = renderEditor({
      post: { ...post, date: "not-a-date" },
    });

    // A corrupted stored date must not crash the editor (#154); the
    // input just starts empty until a valid date is picked.
    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).toHaveValue("");
  });

  it("toggles the published flag", async () => {
    const { setPost } = renderEditor();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(setPost).toHaveBeenCalledWith({ ...post, isPublished: true });
  });

  it("passes content edits up through setContent", () => {
    const { setContent } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("post content"), {
      target: { value: "<p>edited</p>" },
    });
    expect(setContent).toHaveBeenCalledWith("<p>edited</p>");
  });

  it("saves and closes through the editor controls", async () => {
    const { onSave, onClose } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when the page says the post is invalid", () => {
    renderEditor({ saveDisabled: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says what it is editing and labels the title, date and checkbox", () => {
    renderEditor();
    expect(
      screen.getByRole("heading", { name: "Edit post" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue(post.title);
    expect(screen.getByLabelText("Date")).toHaveValue("2024-05-01");
    // The bare <label>Published</label> pointed at nothing, so clicking
    // the word did not toggle the box (#457).
    expect(screen.getByLabelText("Published")).toBe(
      screen.getByRole("checkbox"),
    );
  });

  it("toggles the published flag by clicking its label", async () => {
    const { setPost } = renderEditor();
    await userEvent.click(screen.getByText("Published"));
    expect(setPost).toHaveBeenCalledWith({ ...post, isPublished: true });
  });

  // A ticked checkbox is the one control the browser still paints itself,
  // and it paints it system blue — the only blue on a screen of warm
  // browns. jsdom applies no stylesheet, so the tint is read from the CSS.
  // Since #565 the tint is the shared `--admin-primary` token rather than a
  // repeated hex, so what this pins is "the admin's brown", not "some
  // literal colour" — which is the stronger claim anyway. That the token
  // itself is defined, and defined once, is ui/test/design's job.
  it("tints the checkbox with the admin's own colour, not the browser's", () => {
    const adminCss = readFileSync("apps/admin/src/admin.css", "utf-8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const block = adminCss.match(/input\[type="checkbox"\]\s*\{([^}]*)\}/)?.[1];
    expect(block).toMatch(/accent-color\s*:\s*var\(\s*--admin-primary\s*\)/i);
  });
});
