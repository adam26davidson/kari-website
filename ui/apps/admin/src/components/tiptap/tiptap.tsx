import {
  faAlignCenter,
  faAlignJustify,
  faAlignLeft,
  faAlignRight,
  faBold,
  faImage,
  faItalic,
  faLink,
  faListOl,
  faListUl,
  faStrikethrough,
  faUnlink,
  IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import "./tiptap.css";

import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import { FormEvent, useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ChevronDown } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../ui/cn";
import { LinkBubbleMenu } from "./link-bubble-menu";
import { linkRefusedMessage } from "./link-refusal-message";

const HEADING_LEVELS = [1, 2, 3] as const;

// The Link extension reports a refusal by returning false from setLink
// rather than by throwing, so the panel says so instead of failing
// silently. A URL can be refused for what it is (a protocol outside the
// allow-list: javascript:, data:, ...) -- linkRefusedMessage asks the live
// editor what to suggest instead -- or for where it lands (a block that
// holds no marks at all), which is this message.
const LINK_UNSUPPORTED_HERE_MESSAGE =
  "That link was not applied: this block cannot hold a link.";

// Whether a link mark is legal where the selection starts. can() cannot
// answer this for a collapsed cursor — ProseMirror's canSetMark only tests
// mark exclusion there, never the parent node's allowed marks — so a
// cursor inside a code block passes every check the extension offers,
// stores a link mark the block then silently drops, and reports success.
// Reachable without a toolbar button: StarterKit's ``` input rule makes a
// code block.
const blockAcceptsLinks = (editor: Editor) =>
  editor.state.selection.$from.parent.type.allowsMarkType(
    editor.schema.marks.link,
  );

// Toolbar items that drive menu state rather than the document receive
// these callbacks alongside the editor.
interface MenuActions {
  toggleLinkPanel: () => void;
  addImage: () => void;
}

interface ToolbarItem {
  // The internal slug: a stable React key and the handle the toolbar uses
  // to single an item out. Never shown to anyone.
  name: string;
  // What the button is called out loud. Every button here is an icon with
  // no text beside it, so this is the whole of what a screen reader
  // announces and what the hover tooltip says.
  label: string;
  icon: IconDefinition;
  command: (editor: Editor, menu: MenuActions) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
}

interface ToolbarGroup {
  name: string;
  items: ToolbarItem[];
}

// The board's order (`WorksEditor.png`): what the words look like, then
// what they point at, then how the block is shaped. Every group is a group
// now — the old `grouped` flag existed because three of them sat inside a
// shared grey slab and the other two did not, which grouped by look rather
// than by meaning and left link, unlink and image floating as loose
// buttons. Each group is a run of ghost buttons behind a hairline, so the
// toolbar reads as five short sentences instead of thirteen identical
// glyphs (visual review, PR #829; the 390px wrap remainder is #681).
const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    name: "marks",
    items: [
      {
        name: "bold",
        label: "Bold",
        icon: faBold,
        command: (editor) => editor.chain().focus().toggleBold().run(),
        isActive: (editor) => editor.isActive("bold"),
      },
      {
        name: "italic",
        label: "Italic",
        icon: faItalic,
        command: (editor) => editor.chain().focus().toggleItalic().run(),
        isActive: (editor) => editor.isActive("italic"),
      },
      {
        name: "strike",
        label: "Strikethrough",
        icon: faStrikethrough,
        command: (editor) => editor.chain().focus().toggleStrike().run(),
        isActive: (editor) => editor.isActive("strike"),
      },
    ],
  },
  // What the words point at: putting a link or a picture into the post,
  // and taking a link back off. Both link controls stay — whether the
  // unlink button earns its place beside the panel's "submit it empty" is
  // #698's question, not this migration's.
  {
    name: "insert",
    items: [
      {
        name: "link",
        label: "Add or edit a link",
        icon: faLink,
        command: (_editor, menu) => menu.toggleLinkPanel(),
        isActive: (editor) => editor.isActive("link"),
      },
      {
        name: "unlink",
        label: "Remove the link",
        icon: faUnlink,
        command: (editor) => editor.chain().focus().unsetLink().run(),
        isDisabled: (editor) => !editor.isActive("link"),
      },
      {
        name: "image",
        label: "Add an image",
        icon: faImage,
        command: (_editor, menu) => menu.addImage(),
      },
    ],
  },
  {
    name: "lists",
    items: [
      {
        name: "bullet-list",
        label: "Bulleted list",
        icon: faListUl,
        command: (editor) => editor.chain().focus().toggleBulletList().run(),
        isActive: (editor) => editor.isActive("bulletList"),
      },
      {
        name: "ordered-list",
        label: "Numbered list",
        icon: faListOl,
        command: (editor) => editor.chain().focus().toggleOrderedList().run(),
        isActive: (editor) => editor.isActive("orderedList"),
      },
    ],
  },
  {
    name: "alignment",
    items: (
      [
        { align: "left", label: "Align left", icon: faAlignLeft },
        { align: "center", label: "Align center", icon: faAlignCenter },
        { align: "right", label: "Align right", icon: faAlignRight },
        { align: "justify", label: "Justify", icon: faAlignJustify },
      ] as const
    ).map(({ align, label, icon }) => ({
      name: `align-${align}`,
      label,
      icon,
      command: (editor) => editor.chain().focus().setTextAlign(align).run(),
      isActive: (editor) => editor.isActive({ textAlign: align }),
    })),
  },
];

const ToolbarButton = ({
  editor,
  item,
  menu,
  expanded,
}: {
  editor: Editor;
  item: ToolbarItem;
  menu: MenuActions;
  expanded?: boolean;
}) => {
  const active = item.isActive?.(editor);

  return (
    <button
      type="button"
      onClick={() => item.command(editor, menu)}
      aria-expanded={expanded}
      // The highlight says "this is on" to anyone who can see it;
      // aria-pressed says the same thing to anyone who cannot. A button
      // that discloses a panel reports aria-expanded instead — carrying
      // both would tell assistive tech two stories about one press — and a
      // button that just acts once reports neither.
      aria-pressed={expanded === undefined ? active : undefined}
      // Ghost until it is on or under the pointer, and then the board's
      // filled green pill (`WorksEditor.png`). Driven off `aria-pressed`
      // and `aria-expanded` rather than off a class of its own: the state
      // a screen reader is told and the state a sighted author sees are
      // then the SAME fact, and cannot drift apart the way an `is-active`
      // class could.
      className={cn(
        "text-muted-foreground inline-flex size-9 shrink-0 cursor-pointer",
        "items-center justify-center rounded-md bg-transparent",
        "transition-colors hover:bg-muted hover:text-foreground",
        "aria-pressed:bg-primary/10 aria-pressed:text-primary",
        "aria-expanded:bg-primary/10 aria-expanded:text-primary",
        "disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:size-4",
      )}
      disabled={item.isDisabled?.(editor)}
      aria-label={item.label}
      title={item.label}
    >
      <FontAwesomeIcon icon={item.icon} />
    </button>
  );
};

const MenuBar = ({
  editor,
  onAddImage,
}: {
  editor: Editor | null;
  onAddImage: (file: File, id: string) => void;
}) => {
  // null = the link panel is closed; a string = the current input value.
  // Declared above the null guard so the hook order never changes.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  if (!editor) {
    return null;
  }

  // Opening the panel prefills it with whatever link the cursor is in, so
  // the bubble menu's "edit" and the toolbar's link button land in the same
  // place with the same value.
  const openLinkPanel = () => {
    setLinkError(null);
    setLinkDraft(editor.getAttributes("link").href ?? "");
  };

  const toggleLinkPanel = () => {
    if (linkDraft !== null) {
      setLinkError(null);
      setLinkDraft(null);
      return;
    }
    openLinkPanel();
  };

  // The draft is passed in rather than read from state so the caller's
  // "panel is open" narrowing carries the non-null type through.
  const applyLink = (event: FormEvent, draft: string) => {
    event.preventDefault();
    const href = draft.trim();

    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkDraft(null);
      return;
    }

    // Where first: a block that takes no marks refuses any URL, however
    // impeccable, and only this check sees it coming.
    if (!blockAcceptsLinks(editor)) {
      setLinkError(LINK_UNSUPPORTED_HERE_MESSAGE);
      return;
    }

    // Then what. Asking can() before applying, rather than only reading
    // the chain's return value, keeps a refusal from moving the caret:
    // chain().focus() hands focus to the editor on the next frame even
    // when setLink then refuses the href, pulling it out of the panel the
    // author still needs to correct. The applied chain's own result is
    // still the last word, so a refusal neither check predicted surfaces
    // as an error rather than as a discarded URL.
    const applied =
      editor.can().setLink({ href }) &&
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();

    if (!applied) {
      setLinkError(linkRefusedMessage(editor));
      return;
    }

    setLinkDraft(null);
  };

  const addImage = () => {
    // prompt user to select a file
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();
    input.onchange = async () => {
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      const id = uuidv4();

      onAddImage(file, id);

      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result as string;
        editor.chain().focus().setImage({ src: base64String, title: id }).run();
      };
      reader.readAsDataURL(file);
    };
  };

  const activeHeadingLevel = HEADING_LEVELS.find((level) =>
    editor.isActive("heading", { level }),
  );
  const headingValue = activeHeadingLevel
    ? `h${activeHeadingLevel}`
    : editor.isActive("paragraph")
      ? "p"
      : "";

  const menu: MenuActions = { toggleLinkPanel, addImage };

  return (
    // `control-group` is NOT styling — it is how the admin e2e journeys
    // scope to the toolbar (e2e/admin-journeys.spec.ts), the same
    // convention `data-editor` and `tiptap-container` document. The
    // stylesheet that used to key off it is gone.
    <div className="control-group border-border bg-muted/40 relative w-full rounded-t-lg border-b">
      <div className="flex flex-row flex-wrap items-center gap-y-1 p-1.5">
        {/* Still a native <select> — it keeps the OS picker, the keyboard
            behaviour and the `combobox` role the tests and e2e locate by,
            and needs no extra dependency. What changes is that
            `appearance-none` takes the OS chrome OFF (the system arrow and
            the platform's own corner and background rendering, which is
            what made it the one control in this toolbar that looked
            borrowed from another program: visual review, PR #852), leaving
            the field skin below to draw the whole control. The chevron is
            then ours, in the toolbar's muted ink. */}
        <span className="relative mr-1.5 inline-flex items-center">
          <select
            aria-label="text style"
            // The one control here with words rather than a glyph, so it
            // wears the field skin the rest of the editor's inputs do.
            // `pr-8` is the room the chevron beside it stands in.
            className="border-input bg-popover text-foreground h-9 cursor-pointer appearance-none rounded-md border py-0 pl-2 pr-8 font-sans text-sm"
            onChange={(event) => {
              const value = event.target.value;
              const level = HEADING_LEVELS.find((l) => value === `h${l}`);
              if (level) {
                editor.chain().focus().toggleHeading({ level }).run();
              } else if (value === "p") {
                editor.chain().focus().setParagraph().run();
              }
            }}
            value={headingValue}
          >
            {/* Blocks that are neither a heading nor a paragraph (a code
                block, say) select nothing. Without a blank option to land
                on, the select would fall back to its first option and
                mislabel such a block as "Heading 1". */}
            <option value="" disabled hidden></option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="p">Paragraph</option>
          </select>
          {/* Decorative: the select it sits on is already named and
              already announces its own value, so this is hidden from
              assistive tech and transparent to the pointer — clicking the
              arrow has to open the menu, not do nothing. */}
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2"
          />
        </span>
        {TOOLBAR_GROUPS.map((group, idx) => (
          // A hairline before each group but the first, and the groups are
          // what the row wraps at: at 390px the toolbar breaks between
          // sentences rather than mid-word (`WorksEditorMobile.png`).
          <div
            key={group.name}
            className={cn(
              "flex flex-row items-center",
              idx > 0 && "border-border ml-1.5 border-l pl-1.5",
            )}
          >
            {group.items.map((item) => (
              <ToolbarButton
                key={item.name}
                editor={editor}
                item={item}
                menu={menu}
                expanded={item.name === "link" ? linkDraft !== null : undefined}
              />
            ))}
          </div>
        ))}
      </div>
      {/* One link surface at a time: while the panel is open it holds the
          address being edited, and a bubble still showing the old one over
          the same words would only be in the way. */}
      {linkDraft === null && (
        <LinkBubbleMenu editor={editor} onEdit={openLinkPanel} />
      )}
      {linkDraft !== null && (
        // An on-demand panel hanging off the toolbar row. It sits OUTSIDE
        // the toolbar's flex row so that row cannot wrap around it, which
        // is why it positions itself against `.control-group` above.
        <form
          className="border-border bg-card absolute top-full left-2 z-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded-lg border p-2 shadow-[0_4px_16px_rgba(74,62,40,0.16)]"
          onSubmit={(event) => applyLink(event, linkDraft)}
        >
          <Input
            aria-label="link url"
            // Not type="url": the extension accepts relative paths and
            // mailto: without a host, which native url validation rejects.
            type="text"
            autoFocus
            // `min-w-0` lets the field shrink inside the flex row instead
            // of pushing the panel past the editor's width at 390px.
            className="h-9 w-auto min-w-0 flex-[1_1_220px]"
            value={linkDraft}
            onChange={(event) => {
              setLinkDraft(event.target.value);
              setLinkError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                toggleLinkPanel();
              }
            }}
            placeholder="https://"
          />
          <Button type="submit" size="sm">
            apply
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={toggleLinkPanel}
          >
            cancel
          </Button>
          {linkError && (
            // A full-width row under the field, in the admin's one danger
            // colour — the same statement the error toasts and the
            // outlined Delete make, in the shape a popover can afford.
            <p
              className="bg-destructive text-destructive-foreground basis-full rounded-md px-2 py-1.5 font-sans text-xs [overflow-wrap:anywhere]"
              role="alert"
            >
              {linkError}
            </p>
          )}
        </form>
      )}
    </div>
  );
};

export function Tiptap({
  content,
  setContent,
  onAddImage,
}: {
  content: string;
  setContent: (content: string) => void;
  onAddImage: (image: File, id: string) => void;
}) {
  const editor = useEditor({
    // Tiptap 3 stopped re-rendering the React tree on every transaction.
    // The toolbar reads isActive() straight off the editor during render,
    // so without this the buttons and the block-style select freeze at
    // whatever the document looked like when the editor was created.
    shouldRerenderOnTransaction: true,
    extensions: [
      // StarterKit already bundles Document, ListItem, Dropcursor and —
      // since Tiptap 3 — Link; registering any of them again triggers
      // Tiptap's duplicate-extension warning.
      StarterKit.configure({
        // Two more of Tiptap 3's StarterKit additions change the schema,
        // and the blog posts already in the bucket were written without
        // them. Underline would start parsing stored <u> tags as a mark
        // the toolbar offers no way to remove, and TrailingNode appends
        // an empty paragraph to any document ending in a list or an
        // image — which getHTML() then reports as an edit, so merely
        // opening an old post would queue a save. Both stay off.
        underline: false,
        trailingNode: false,
        link: {
          // Link defaults to opening its href on click, and since its
          // other default puts target="_blank" on every anchor, clicking
          // a link in the editor opened a new tab instead of putting the
          // cursor in the text — so editing a link's wording meant
          // clicking beside it. Only the click behaviour is overridden
          // here: target="_blank" is what the published post wants, so
          // the rest of HTMLAttributes stays as it is.
          openOnClick: false,
        },
      }),
      Image.configure({
        HTMLAttributes: {
          className: "blog-post-image",
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content: content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setContent(html);
    },
  });

  return (
    // The writing surface: the boards' field skin, sized like one — the
    // toolbar along its top and the post below it (`WorksEditor.png`).
    // `min-h` with no max, so a short post still gets a surface worth
    // writing in and a long one grows the card; `.admin-content` is the
    // admin's one scroll container.
    //
    // `tiptap-container` is NOT styling — it is how the admin e2e journeys
    // find the prose area (`.tiptap-container .ProseMirror`), the same
    // convention `data-editor` and `control-group` document.
    <div className="tiptap-container border-input bg-popover flex min-h-[350px] w-full flex-col items-start justify-start rounded-lg border">
      <MenuBar editor={editor} onAddImage={onAddImage} />
      <EditorContent editor={editor} className="editor w-full flex-1" />
    </div>
  );
}
