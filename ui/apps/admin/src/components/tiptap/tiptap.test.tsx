import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tiptap } from "./tiptap";

// useEditor returns null until the editor instance exists. That never
// happens in these tests, so the toolbar's null guard is only reachable by
// forcing the hook to withhold the editor for one test.
const editorState = vi.hoisted(() => ({ withheld: false }));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: ((...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      return editorState.withheld ? null : editor;
    }) as typeof actual.useEditor,
  };
});

afterEach(() => {
  editorState.withheld = false;
});

// Toolbar buttons carry aria-labels from their config names, so they can
// be looked up through their accessible name.
const getButton = (name: string) =>
  screen.getByRole("button", { name });

// The link panel's input is the only named textbox; the editor itself is a
// contenteditable textbox with no accessible name.
const getLinkInput = () =>
  screen.getByRole("textbox", { name: "link url" });
const queryLinkInput = () =>
  screen.queryByRole("textbox", { name: "link url" });

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

  it("omits the toolbar entirely until the editor exists", () => {
    editorState.withheld = true;
    const { container } = renderTiptap();

    expect(container.querySelector(".control-group")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // the editor slot still renders, so the toolbar can appear beside it
    expect(container.querySelector(".tiptap-container")).toBeInTheDocument();
  });

  it("leaves the text-style select blank on a block it cannot name", () => {
    // a code block is neither a heading nor a paragraph, so neither option
    // matches and the select falls back to no selection
    renderTiptap("<pre><code>const x = 1;</code></pre>");

    expect(screen.getByRole("combobox", { name: "text style" })).toHaveValue("");
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

  it.each(["bold", "italic", "strike"])(
    "marks the %s button active once toggled",
    async (mark) => {
      const user = userEvent.setup();
      renderTiptap();
      const button = getButton(mark);

      expect(button.className).not.toContain("is-active");
      await user.click(button);
      expect(button.className).toContain("is-active");
      await user.click(button);
      expect(button.className).not.toContain("is-active");
    }
  );

  it("tracks the active text alignment across the alignment buttons", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();
    const center = getButton("align-center");
    const left = getButton("align-left");

    await user.click(center);
    expect(center.className).toContain("is-active");
    expect(left.className).not.toContain("is-active");
    // Tiptap 3's TextAlign extension terminates the inline style with a
    // semicolon; Tiptap 2 did not. Cosmetic in the stored HTML, and the
    // public site's renderer is indifferent to it.
    expect(setContent).toHaveBeenCalledWith(
      '<p style="text-align: center;">hello</p>'
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

  it("opens the link panel from the link button and closes it again", async () => {
    const user = userEvent.setup();
    renderTiptap();

    expect(getButton("link")).toHaveAttribute("aria-expanded", "false");
    await user.click(getButton("link"));
    expect(getLinkInput()).toBeInTheDocument();
    expect(getButton("link")).toHaveAttribute("aria-expanded", "true");

    await user.click(getButton("link"));
    expect(queryLinkInput()).toBeNull();
    expect(getButton("link")).toHaveAttribute("aria-expanded", "false");
  });

  it("prefills the panel with the current link's href", async () => {
    const user = userEvent.setup();
    renderTiptap('<p><a href="https://x.test/">hello</a></p>');

    await user.click(getButton("link"));
    expect(getLinkInput()).toHaveValue("https://x.test/");
  });

  it("opens the panel empty when the cursor is not on a link", async () => {
    const user = userEvent.setup();
    renderTiptap();

    await user.click(getButton("link"));
    expect(getLinkInput()).toHaveValue("");
  });

  it("applies a typed url as a link", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(
      '<p><a href="https://old.test/">hello</a></p>'
    );

    await user.click(getButton("link"));
    await user.clear(getLinkInput());
    await user.type(getLinkInput(), "https://example.com");
    await user.click(getButton("apply"));

    expect(setContent).toHaveBeenLastCalledWith(
      expect.stringContaining('href="https://example.com"')
    );
    expect(queryLinkInput()).toBeNull();
  });

  it("submits the panel with Enter", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(
      '<p><a href="https://old.test/">hello</a></p>'
    );

    await user.click(getButton("link"));
    await user.clear(getLinkInput());
    await user.type(getLinkInput(), "https://enter.test/{Enter}");

    expect(setContent).toHaveBeenLastCalledWith(
      expect.stringContaining('href="https://enter.test/"')
    );
    expect(queryLinkInput()).toBeNull();
  });

  it("removes the link when the panel is submitted empty", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(
      '<p><a href="https://x.test/">hello</a></p>'
    );

    await user.click(getButton("link"));
    await user.clear(getLinkInput());
    await user.click(getButton("apply"));

    expect(setContent).toHaveBeenLastCalledWith("<p>hello</p>");
    expect(getButton("unlink")).toBeDisabled();
    expect(queryLinkInput()).toBeNull();
  });

  it("shows an inline error and keeps the panel open when the url is refused", async () => {
    const user = userEvent.setup();
    // Tiptap's Link extension rejects any protocol outside its allow-list,
    // reporting it by returning false rather than by throwing.
    const { setContent } = renderTiptap();

    await user.click(getButton("link"));
    await user.type(getLinkInput(), "javascript:alert(1)");
    await user.click(getButton("apply"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /only http\(s\), mailto, tel and relative URLs are allowed/
    );
    expect(getLinkInput()).toHaveValue("javascript:alert(1)");
    expect(setContent).not.toHaveBeenCalled();
    expect(getButton("link").className).not.toContain("is-active");
  });

  it("keeps the panel open when the block cannot hold a link", async () => {
    const user = userEvent.setup();
    // A code block allows no marks at all, so the extension refuses a URL
    // its allow-list is perfectly happy with. can().setLink only judges the
    // URL, so this refusal is invisible until the chain itself is asked.
    // Code blocks need no toolbar button to reach: StarterKit's ``` input
    // rule makes one.
    const { setContent } = renderTiptap("<pre><code>hello</code></pre>");

    await user.click(getButton("link"));
    await user.type(getLinkInput(), "https://example.com");
    await user.click(getButton("apply"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /this block cannot hold a link/
    );
    expect(getLinkInput()).toHaveValue("https://example.com");
    expect(setContent).not.toHaveBeenCalled();
  });

  it("clears the error once the url is edited", async () => {
    const user = userEvent.setup();
    renderTiptap();

    await user.click(getButton("link"));
    await user.type(getLinkInput(), "javascript:alert(1)");
    await user.click(getButton("apply"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(getLinkInput(), "!");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes the panel on Escape without touching the document", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();

    await user.click(getButton("link"));
    await user.type(getLinkInput(), "https://example.com{Escape}");

    expect(queryLinkInput()).toBeNull();
    expect(setContent).not.toHaveBeenCalled();
  });

  it("closes the panel from the cancel button without applying", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap();

    await user.click(getButton("link"));
    await user.type(getLinkInput(), "https://example.com");
    await user.click(getButton("cancel"));

    expect(queryLinkInput()).toBeNull();
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

  it("does not append a trailing paragraph to a document ending in a list", async () => {
    // Tiptap 3's StarterKit bundles TrailingNode, which would add an empty
    // paragraph after a closing list or image. getHTML() reports that as an
    // edit, so an untouched post would come back from the editor changed and
    // queue a pointless save. The extension is configured off; this pins it.
    const user = userEvent.setup();
    const { setContent } = renderTiptap("<ul><li><p>only item</p></li></ul>");

    await user.click(getButton("ordered-list"));

    expect(setContent).toHaveBeenLastCalledWith(
      "<ol><li><p>only item</p></li></ol>"
    );
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
