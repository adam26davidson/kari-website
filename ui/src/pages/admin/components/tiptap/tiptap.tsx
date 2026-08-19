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
import StarterKit from "@tiptap/starter-kit";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { v4 as uuidv4 } from "uuid";

const HEADING_LEVELS = [1, 2, 3] as const;

const setLink = (editor: Editor) => {
  const previousUrl = editor.getAttributes("link").href;
  const url = window.prompt("URL", previousUrl);

  // cancelled
  if (url === null) {
    return;
  }

  // empty
  if (url === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();

    return;
  }

  // update link. setLink reports failure by returning false rather than
  // throwing: the Link extension refuses any protocol outside its
  // allow-list (javascript:, data:, ...), which would otherwise be a
  // silent no-op for the author.
  const applied = editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: url })
    .run();

  if (!applied) {
    console.error("Could not set link:", url);
  }
};

interface ToolbarItem {
  name: string;
  icon: IconDefinition;
  command: (editor: Editor) => void;
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
        command: setLink,
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
}: {
  editor: Editor;
  item: ToolbarItem;
}) => (
  <button
    onClick={() => item.command(editor)}
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
  if (!editor) {
    return null;
  }

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
                <ToolbarButton key={item.name} editor={editor} item={item} />
              ))}
            </div>
          ) : (
            group.items.map((item) => (
              <ToolbarButton key={item.name} editor={editor} item={item} />
            ))
          ),
        )}
        <button onClick={addImage} aria-label="image" title="image">
          <FontAwesomeIcon icon={faImage} />
        </button>
      </div>
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
