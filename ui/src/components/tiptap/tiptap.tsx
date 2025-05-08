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
} from "@fortawesome/free-solid-svg-icons";
import "./tiptap.css";

import TextAlign from "@tiptap/extension-text-align";
import ListItem from "@tiptap/extension-list-item";
import Document from "@tiptap/extension-document";
import Dropcursor from "@tiptap/extension-dropcursor";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { v4 as uuidv4 } from "uuid";

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

  const setLink = () => {
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

    // update link
    try {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    } catch (e) {
      console.error("Error setting link:", e);
    }
  };

  if (!editor) {
    return null;
  }

  return (
    <div className="control-group">
      <div className="button-group">
        <select
          onChange={(event) => {
            const value = event.target.value;
            if (value === "h1") {
              editor.chain().focus().toggleHeading({ level: 1 }).run();
            } else if (value === "h2") {
              editor.chain().focus().toggleHeading({ level: 2 }).run();
            } else if (value === "h3") {
              editor.chain().focus().toggleHeading({ level: 3 }).run();
            } else if (value === "p") {
              editor.chain().focus().setParagraph().run();
            }
          }}
          value={
            editor.isActive("heading", { level: 1 })
              ? "h1"
              : editor.isActive("heading", { level: 2 })
                ? "h2"
                : editor.isActive("heading", { level: 3 })
                  ? "h3"
                  : editor.isActive("paragraph")
                    ? "p"
                    : ""
          }
        >
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="p">Paragraph</option>
        </select>
        <div className="grouped-buttons">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
          >
            <FontAwesomeIcon icon={faBold} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
          >
            <FontAwesomeIcon icon={faItalic} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive("strike") ? "is-active" : ""}
          >
            <FontAwesomeIcon icon={faStrikethrough} />
          </button>
        </div>
        <div className="grouped-buttons">
          <button
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            className={
              editor.isActive({ textAlign: "left" }) ? "is-active" : ""
            }
          >
            <FontAwesomeIcon icon={faAlignLeft} />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            className={
              editor.isActive({ textAlign: "center" }) ? "is-active" : ""
            }
          >
            <FontAwesomeIcon icon={faAlignCenter} />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            className={
              editor.isActive({ textAlign: "right" }) ? "is-active" : ""
            }
          >
            <FontAwesomeIcon icon={faAlignRight} />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            className={
              editor.isActive({ textAlign: "justify" }) ? "is-active" : ""
            }
          >
            <FontAwesomeIcon icon={faAlignJustify} />
          </button>
        </div>
        <div className="grouped-buttons">
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive("bulletList") ? "is-active" : ""}
          >
            <FontAwesomeIcon icon={faListUl} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive("orderedList") ? "is-active" : ""}
          >
            <FontAwesomeIcon icon={faListOl} />
          </button>
        </div>
        <button
          onClick={setLink}
          className={editor.isActive("link") ? "is-active" : ""}
        >
          <FontAwesomeIcon icon={faLink} />
        </button>
        <button
          onClick={() => editor.chain().focus().unsetLink().run()}
          disabled={!editor.isActive("link")}
        >
          <FontAwesomeIcon icon={faUnlink} />
        </button>
        <button onClick={addImage}>
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
      ListItem,
      StarterKit,
      Link,
      Image.configure({
        HTMLAttributes: {
          className: "blog-post-image",
        },
      }),
      Document,
      Dropcursor,
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

  // whenever img is removed, call onRemoveImage

  return (
    <div className="tiptap-container">
      <MenuBar editor={editor} onAddImage={onAddImage} />
      <EditorContent editor={editor} className="editor" />
    </div>
  );
}
