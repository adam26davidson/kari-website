import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { Tiptap } from "./tiptap";
import { LINK_EXAMPLES } from "./link-refusal-message";
import { shouldShowLinkBubble } from "./link-bubble-visibility";

// useEditor returns null until the editor instance exists. That never
// happens in these tests, so the toolbar's null guard is only reachable by
// forcing the hook to withhold the editor for one test.
// The same wrapper keeps the last editor instance to hand, which is the
// only way a test can reach the extensions the component configured.
const editorState = vi.hoisted(() => ({
  withheld: false,
  editor: null as Editor | null,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: ((...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      editorState.editor = editor;
      return editorState.withheld ? null : editor;
    }) as typeof actual.useEditor,
  };
});

const getEditor = () => {
  const editor = editorState.editor;
  if (!editor) {
    throw new Error("the editor was never created");
  }
  return editor;
};

afterEach(() => {
  editorState.withheld = false;
  editorState.editor = null;
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

  it("does not open the link target when a link is clicked", () => {
    // A real click cannot reach the Link extension's handler under jsdom:
    // ProseMirror's own mousedown listener runs first and calls
    // posAtCoords, which needs document.elementFromPoint — jsdom has no
    // layout and no such method, so it throws before handleClick is ever
    // consulted. Invoking the prop the way EditorView does exercises the
    // configured extension's real click plugin instead of a stand-in.
    // jsdom's window.open only logs "Not implemented", so the spy both
    // records the call and silences it.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = renderTiptap(
      '<p><a href="https://x.test/">hello</a></p>'
    );
    const view = getEditor().view;
    const anchor = container.querySelector(".editor a");
    expect(anchor).not.toBeNull();

    const event = new MouseEvent("click", { button: 0, bubbles: true });
    Object.defineProperty(event, "target", { value: anchor });
    const handled = view.someProp("handleClick", (handler) =>
      handler(view, 1, event)
    );

    expect(open).not.toHaveBeenCalled();
    // Unhandled, so ProseMirror goes on to place the cursor in the text.
    expect(handled).toBeFalsy();
  });

  it("keeps target=_blank on stored links so published posts open in a new tab", () => {
    const { container } = renderTiptap(
      '<p><a href="https://x.test/">hello</a></p>'
    );
    const anchor = container.querySelector(".editor a");

    expect(anchor).toHaveAttribute("target", "_blank");
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

    // The suggestions are derived from the editor the component actually
    // configured, so this asserts them against that live editor rather
    // than against a copy of the sentence.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/That link was not applied\. Try /);
    for (const { href } of LINK_EXAMPLES) {
      expect(alert).toHaveTextContent(href);
      expect(getEditor().can().setLink({ href })).toBe(true);
    }

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

// The bubble menu that appears over a link the cursor is sitting in.
describe("Tiptap link bubble menu", () => {
  const LINKED = '<p><a href="https://x.test/">hello</a></p>';

  // shouldShow receives the live view; only its focus report matters here,
  // and jsdom cannot supply a real one (see focusEditor below), so the
  // predicate is asked directly with the focus state each case is about.
  const askPredicate = (focused: boolean, element?: HTMLElement) =>
    shouldShowLinkBubble({
      editor: getEditor(),
      element: element ?? document.createElement("div"),
      view: { hasFocus: () => focused } as unknown as EditorView,
    });

  // jsdom implements no layout and does not treat a contenteditable element
  // as focusable, so editor.commands.focus() leaves document.activeElement
  // on the body and view.hasFocus() false — the bubble would never appear.
  // Stubbing the view's focus report and then moving the cursor for real
  // drives the plugin through its own show path: a collapsed selection
  // skips the 250 ms update debounce, so the menu is up synchronously.
  const focusEditor = async (pos = 2) => {
    const editor = getEditor();
    vi.spyOn(editor.view, "hasFocus").mockReturnValue(true);
    await act(async () => {
      editor.commands.setTextSelection(pos);
    });
  };

  const queryBubble = () =>
    screen.queryByRole("group", { name: "link actions" });

  it("shows the bubble for a cursor inside a link in a focused editor", () => {
    renderTiptap(LINKED);
    expect(askPredicate(true)).toBe(true);
  });

  it("keeps the bubble away from text that is not a link", () => {
    renderTiptap();
    expect(askPredicate(true)).toBe(false);
  });

  it("hides the bubble once focus leaves both the editor and the bubble", () => {
    renderTiptap(LINKED);
    expect(askPredicate(false)).toBe(false);
  });

  it("keeps the bubble up while focus is inside the bubble itself", () => {
    // Clicking "edit" or "remove" moves focus off the editor and into the
    // menu; the menu has to survive its own buttons being pressed.
    renderTiptap(LINKED);
    const element = document.createElement("div");
    const button = document.createElement("button");
    element.appendChild(button);
    document.body.appendChild(element);
    button.focus();

    expect(document.activeElement).toBe(button);
    expect(askPredicate(false, element)).toBe(true);
  });

  it("offers no bubble while the editor is read-only", () => {
    renderTiptap(LINKED);
    act(() => {
      getEditor().setEditable(false);
    });

    expect(askPredicate(true)).toBe(false);
  });

  it("shows the link's address with edit and remove actions", async () => {
    renderTiptap(LINKED);
    await focusEditor();

    expect(queryBubble()).toBeInTheDocument();
    const address = screen.getByRole("link", { name: "https://x.test/" });
    expect(address).toHaveAttribute("href", "https://x.test/");
    // The address is a peek at where the link goes, so it must not navigate
    // the admin away from the post being written.
    expect(address).toHaveAttribute("target", "_blank");
    expect(address).toHaveAttribute("rel", "noopener noreferrer");
    expect(getButton("edit")).toBeInTheDocument();
    expect(getButton("remove")).toBeInTheDocument();
  });

  it("shows no bubble in a document with no link under the cursor", async () => {
    renderTiptap();
    await focusEditor();

    expect(queryBubble()).toBeNull();
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
  });

  it("opens the toolbar's link panel prefilled from the edit action", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(LINKED);
    await focusEditor();

    await user.click(getButton("edit"));

    // The panel is the one place a url is typed, so edit reuses it rather
    // than offering a second input inside the bubble.
    expect(getLinkInput()).toHaveValue("https://x.test/");
    expect(getButton("link")).toHaveAttribute("aria-expanded", "true");
    // ...and the bubble stands down while the panel is open, so only one
    // link surface is ever on screen at a time.
    await waitFor(() => expect(queryBubble()).toBeNull());
    expect(setContent).not.toHaveBeenCalled();
  });

  it("strips the link from the remove action", async () => {
    const user = userEvent.setup();
    const { setContent } = renderTiptap(LINKED);
    await focusEditor();

    await user.click(getButton("remove"));

    expect(setContent).toHaveBeenLastCalledWith("<p>hello</p>");
    expect(getButton("unlink")).toBeDisabled();
    await waitFor(() => expect(queryBubble()).toBeNull());
  });
});
