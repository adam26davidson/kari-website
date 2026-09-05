import { Editor } from "@tiptap/react";
// Tiptap 3 moved the React menu components out of the package root: they
// pull in floating-ui and the bubble/floating menu extensions, which nobody
// importing an editor should pay for. Hence the `/menus` subpath, and hence
// this app declaring those two extensions itself rather than leaning on
// @tiptap/react listing them as optional dependencies.
import { BubbleMenu } from "@tiptap/react/menus";

import { shouldShowLinkBubble } from "./link-bubble-visibility";
import "./link-bubble-menu.css";

/**
 * The address of the link under the cursor, with the actions for it: open
 * it in a new tab, edit it in the toolbar's link panel, or take it off.
 */
export const LinkBubbleMenu = ({
  editor,
  onEdit,
}: {
  editor: Editor;
  onEdit: () => void;
}) => {
  // Undefined off a link. The menu is hidden then, but its children are
  // still rendered into the plugin's (detached) element.
  const href: string = editor.getAttributes("link").href ?? "";

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShowLinkBubble}
      className="link-bubble"
      role="group"
      aria-label="link actions"
    >
      <a
        className="link-bubble-address"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // The address is truncated to keep the bubble small, so the whole
        // of it stays available on hover.
        title={href}
      >
        {href}
      </a>
      <button type="button" onClick={onEdit}>
        edit
      </button>
      <button
        type="button"
        // unsetLink extends an empty mark range, so a resting cursor is
        // enough — the words do not have to be selected first.
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        remove
      </button>
    </BubbleMenu>
  );
};
