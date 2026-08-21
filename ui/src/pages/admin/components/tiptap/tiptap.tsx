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
import Link from "@tiptap/extension-link";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import { FormEvent, useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { v4 as uuidv4 } from "uuid";

const HEADING_LEVELS = [1, 2, 3] as const;

// The Link extension refuses any protocol outside its allow-list
// (javascript:, data:, ...) by returning false from setLink rather than by
// throwing, so the panel shows this instead of failing silently.
const LINK_REFUSED_MESSAGE =
  "That link was not applied: only http(s), mailto, tel and relative " +
  "URLs are allowed.";

// Toolbar items that drive menu state rather than the document receive
// these callbacks alongside the editor.
interface MenuActions {
  toggleLinkPanel: () => void;
}

interface ToolbarItem {
  name: string;
  icon: IconDefinition;
  command: (editor: Editor, menu: MenuActions) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
}

interface ToolbarGroup {
  name: string;
  // Grouped items render inside a shared .grouped-buttons wrapper;
  // ungrouped items render as bare buttons in the .button-group row.
  grouped: boolean;
  items: ToolbarItem[];
}

const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    name: "marks",
    grouped: true,
    items: [
      {
        name: "bold",
        icon: faBold,
        command: (editor) => editor.chain().focus().toggleBold().run(),
        isActive: (editor) => editor.isActive("bold"),
      },
      {
        name: "italic",
        icon: faItalic,
        command: (editor) => editor.chain().focus().toggleItalic().run(),
        isActive: (editor) => editor.isActive("italic"),
      },
      {
        name: "strike",
        icon: faStrikethrough,
        command: (editor) => editor.chain().focus().toggleStrike().run(),
        isActive: (editor) => editor.isActive("strike"),
      },
    ],
  },
  {
    name: "alignment",
    grouped: true,
    items: (["left", "center", "right", "justify"] as const).map((align) => ({
      name: `align-${align}`,
      icon: {
        left: faAlignLeft,
        center: faAlignCenter,
        right: faAlignRight,
        justify: faAlignJustify,
      }[align],
      command: (editor) => editor.chain().focus().setTextAlign(align).run(),
      isActive: (editor) => editor.isActive({ textAlign: align }),
    })),
  },
  {
    name: "lists",
    grouped: true,
    items: [
      {
        name: "bullet-list",
        icon: faListUl,
        command: (editor) => editor.chain().focus().toggleBulletList().run(),
        isActive: (editor) => editor.isActive("bulletList"),
      },
      {
        name: "ordered-list",
        icon: faListOl,
        command: (editor) => editor.chain().focus().toggleOrderedList().run(),
        isActive: (editor) => editor.isActive("orderedList"),
      },
    ],
  },
  {
    name: "links",
    grouped: false,
    items: [
      {
        name: "link",
        icon: faLink,
        command: (_editor, menu) => menu.toggleLinkPanel(),
        isActive: (editor) => editor.isActive("link"),
      },
      {
        name: "unlink",
        icon: faUnlink,
        command: (editor) => editor.chain().focus().unsetLink().run(),
        isDisabled: (editor) => !editor.isActive("link"),
      },
    ],
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
}) => (
  <button
    type="button"
    onClick={() => item.command(editor, menu)}
    aria-expanded={expanded}
    className={
      item.isActive ? (item.isActive(editor) ? "is-active" : "") : undefined
    }
    disabled={item.isDisabled?.(editor)}
    aria-label={item.name}
    title={item.name}
  >
    <FontAwesomeIcon icon={item.icon} />
  </button>
);

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

  const toggleLinkPanel = () => {
    setLinkError(null);
    setLinkDraft(
      linkDraft === null ? (editor.getAttributes("link").href ?? "") : null,
    );
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

    // Ask before applying rather than reacting to the chain's return
    // value: chain().focus() hands focus to the editor on the next frame
    // even when setLink then refuses the href, which would pull the caret
    // out of the panel the author still needs to correct.
    if (!editor.can().setLink({ href })) {
      setLinkError(LINK_REFUSED_MESSAGE);
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
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

  const menu: MenuActions = { toggleLinkPanel };

  return (
    <div className="control-group">
      <div className="button-group">
        <select
          aria-label="text style"
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
        {TOOLBAR_GROUPS.map((group) =>
          group.grouped ? (
            <div className="grouped-buttons" key={group.name}>
              {group.items.map((item) => (
                <ToolbarButton
                  key={item.name}
                  editor={editor}
                  item={item}
                  menu={menu}
                />
              ))}
            </div>
          ) : (
            group.items.map((item) => (
              <ToolbarButton
                key={item.name}
                editor={editor}
                item={item}
                menu={menu}
                expanded={item.name === "link" ? linkDraft !== null : undefined}
              />
            ))
          ),
        )}
        <button
          type="button"
          onClick={addImage}
          aria-label="image"
          title="image"
        >
          <FontAwesomeIcon icon={faImage} />
        </button>
      </div>
      {linkDraft !== null && (
        <form
          className="link-popover"
          onSubmit={(event) => applyLink(event, linkDraft)}
        >
          <input
            aria-label="link url"
            // Not type="url": the extension accepts relative paths and
            // mailto: without a host, which native url validation rejects.
            type="text"
            autoFocus
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
          <button type="submit">apply</button>
          <button type="button" onClick={toggleLinkPanel}>
            cancel
          </button>
          {linkError && (
            <p className="link-popover-error" role="alert">
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
    extensions: [
      // StarterKit already bundles Document, ListItem, and Dropcursor —
      // registering them again triggers Tiptap's duplicate-extension warning.
      StarterKit,
      Link,
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
    <div className="tiptap-container">
      <MenuBar editor={editor} onAddImage={onAddImage} />
      <EditorContent editor={editor} className="editor" />
    </div>
  );
}
