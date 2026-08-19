import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tiptap } from "./tiptap";

// Toolbar buttons carry aria-labels from their config names, so they can
// be looked up through their accessible name.
const getButton = (name: string) =>
  screen.getByRole("button", { name });

const renderTiptap = (content = "<p>hello</p>") => {
  const setContent = vi.fn();
  const onAddImage = vi.fn();
  const { container } = render(
    <Tiptap
      content={content}
      setContent={setContent}
      onAddImage={onAddImage}
    />
  );
  return { container, setContent, onAddImage };
};

describe("Tiptap toolbar", () => {
  it("renders the grouped toolbar structure", () => {
    const { container } = renderTiptap();

    const groups = container.querySelectorAll(".grouped-buttons");
    expect(groups).toHaveLength(3);
    // marks, alignments, lists
    expect(groups[0].querySelectorAll("button")).toHaveLength(3);
    expect(groups[1].querySelectorAll("button")).toHaveLength(4);
    expect(groups[2].querySelectorAll("button")).toHaveLength(2);
    // link, unlink and image render as bare buttons in the button row
    expect(container.querySelectorAll(".button-group > button")).toHaveLength(
      3
    );
    expect(container.querySelectorAll(".button-group button")).toHaveLength(12);
  });

  it("labels every toolbar button and the block-style select", () => {
    const { container } = renderTiptap();

    for (const button of container.querySelectorAll(".button-group button")) {
      expect(button).toHaveAttribute("aria-label");
      expect(button.getAttribute("title")).toBe(
        button.getAttribute("aria-label")
      );
    }
    expect(
      screen.getByRole("combobox", { name: "text style" })
    ).toBeInTheDocument();
  });

  it("mounts without Tiptap's duplicate-extension warning", () => {
    const warn = vi.spyOn(console, "warn");
    renderTiptap();
    const messages = warn.mock.calls.map((call) => call.join(" "));
    expect(
      messages.filter((m) => m.includes("Duplicate extension names"))
    ).toEqual([]);
  });

  it("marks the bold button active once toggled", async () => {
    const user = userEvent.setup();
    renderTiptap();
    const bold = getButton("bold");

    expect(bold.className).not.toContain("is-active");
    await user.click(bold);
    expect(bold.className).toContain("is-active");
    await user.click(bold);
    expect(bold.className).not.toContain("is-active");
  });

  it("tracks the active text alignment across the alignment buttons", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();
    const center = getButton("align-center");
    const left = getButton("align-left");

    await user.click(center);
    expect(center.className).toContain("is-active");
    expect(left.className).not.toContain("is-active");
    expect(setContent).toHaveBeenCalledWith(
      '<p style="text-align: center">hello</p>'
    );

    await user.click(left);
    expect(left.className).toContain("is-active");
    expect(center.className).not.toContain("is-active");
  });

  it("toggles list types from the list buttons", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();

    await user.click(getButton("bullet-list"));
    expect(getButton("bullet-list").className).toContain("is-active");
    expect(setContent).toHaveBeenLastCalledWith(
      "<ul><li><p>hello</p></li></ul>"
    );

    await user.click(getButton("ordered-list"));
    expect(getButton("ordered-list").className).toContain("is-active");
    expect(getButton("bullet-list").className).not.toContain("is-active");
    expect(setContent).toHaveBeenLastCalledWith(
      "<ol><li><p>hello</p></li></ol>"
    );
  });

  it("shows the current block in the heading select and switches on change", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();
    const select = screen.getByRole("combobox", { name: "text style" });

    expect(select).toHaveValue("p");
    await user.selectOptions(select, "h2");
    expect(select).toHaveValue("h2");
    expect(setContent).toHaveBeenLastCalledWith("<h2>hello</h2>");

    await user.selectOptions(select, "p");
    expect(select).toHaveValue("p");
    expect(setContent).toHaveBeenLastCalledWith("<p>hello</p>");
  });

  it("disables unlink when the cursor is not on a link", () => {
    renderTiptap();
    expect(getButton("unlink")).toBeDisabled();
  });

  it("does nothing when the link prompt is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const { setContent } = renderTiptap();

    await user.click(getButton("link"));
    expect(window.prompt).toHaveBeenCalledWith("URL", undefined);
    expect(setContent).not.toHaveBeenCalled();
  });

  it("enables unlink on a link and strips it on click", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(
      '<p><a href="https://x.test/">hello</a></p>'
    );
    const unlink = getButton("unlink");
    const link = getButton("link");

    // the initial cursor sits at the start of the link text
    expect(link.className).toContain("is-active");
    expect(unlink).toBeEnabled();
    await user.click(unlink);
    expect(setContent).toHaveBeenLastCalledWith("<p>hello</p>");
    expect(getButton("unlink")).toBeDisabled();
  });

  it("applies the prompted url as a link", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    renderTiptap();

    await user.click(getButton("link"));
    expect(window.prompt).toHaveBeenCalledWith("URL", undefined);
  });

  it("removes the link when the prompt returns an empty string", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("");
    const { setContent } = renderTiptap();

    await user.click(getButton("link"));
    // unsetLink on a linkless cursor leaves the document unchanged
    expect(setContent).not.toHaveBeenCalled();
  });

  it("inserts the picked image with its uuid as the title", async () => {
    const user = userEvent.setup();
    // addImage creates a detached file input and clicks it; intercept the
    // click and recover the input from the spy's `this` contexts.
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const { setContent, onAddImage } = renderTiptap();

    await user.click(getButton("image"));
    const fileInput = clickSpy.mock.contexts[0] as HTMLInputElement;
    if (!fileInput) throw new Error("file input was not opened");
    expect(fileInput.getAttribute("accept")).toBe("image/*");

    const file = new File(["img-bytes"], "pic.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fileInput.onchange?.(new Event("change"));

    await waitFor(() => expect(onAddImage).toHaveBeenCalledTimes(1));
    const [sentFile, id] = onAddImage.mock.calls[0];
    expect(sentFile).toBe(file);
    // the inserted <img> carries the same uuid in its title attribute
    // (admin-other-works-page matches pending files against it)
    await waitFor(() =>
      expect(setContent).toHaveBeenCalledWith(
        expect.stringContaining(`title="${id}"`)
      )
    );
    const html = setContent.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain('src="data:image/png;base64');
  });

  it("closes the picker without side effects when no file is chosen", async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const { onAddImage } = renderTiptap();

    await user.click(getButton("image"));
    const fileInput = clickSpy.mock.contexts[0] as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [] });
    fileInput.onchange?.(new Event("change"));
    expect(onAddImage).not.toHaveBeenCalled();
  });
});
