import { Editor } from "@tiptap/react";
// Tiptap 3 moved the React menu components out of the package root: they
// pull in floating-ui and the bubble/floating menu extensions, which nobody
// importing an editor should pay for. Hence the `/menus` subpath, and hence
// this app declaring those two extensions itself rather than leaning on
// @tiptap/react listing them as optional dependencies.
import { BubbleMenu } from "@tiptap/react/menus";
import type { EditorView } from "@tiptap/pm/view";

import "./link-bubble-menu.css";

/**
 * Whether the link bubble belongs on screen. A custom predicate replaces
 * the plugin's default outright, so the parts of the default that still
 * apply are repeated here: an editor that is not editable offers no link
 * actions, and the menu has to stay up while one of its own buttons holds
 * focus, or pressing that button would dismiss it before the click landed.
 *
 * What the default would not allow is the case this menu exists for. It
 * refuses an empty selection, and a cursor resting in a link — which is
 * what clicking a link now does, since #682 stopped the click navigating —
 * is exactly that.
 */
export const shouldShowLinkBubble = ({
  editor,
  element,
  view,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
}) =>
  editor.isEditable &&
  editor.isActive("link") &&
  (view.hasFocus() || element.contains(document.activeElement));

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
