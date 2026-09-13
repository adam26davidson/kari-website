import { Editor } from "@tiptap/react";
// Tiptap 3 moved the React menu components out of the package root: they
// pull in floating-ui and the bubble/floating menu extensions, which nobody
// importing an editor should pay for. Hence the `/menus` subpath, and hence
// this app declaring those two extensions itself rather than leaning on
// @tiptap/react listing them as optional dependencies.
import { BubbleMenu } from "@tiptap/react/menus";

import { Button } from "../ui/button";
import { shouldShowLinkBubble } from "./link-bubble-visibility";

/**
 * The address of the link under the cursor, with the actions for it: open
 * it in a new tab, edit it in the toolbar's link panel, or take it off.
 *
 * Its skin is the toolbar link panel's, so the editor offers one look for
 * link editing wherever it happens.
 *
 * Position, width, visibility and opacity are set INLINE by the bubble-menu
 * plugin, so nothing here may declare them: floating-ui owns where this
 * sits, and these classes own what it looks like once it gets there.
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
      // Narrow enough to sit beside the words it belongs to at 390px,
      // where the plugin's shift middleware nudges it back on screen.
      className="border-border bg-card flex max-w-[280px] items-center gap-2 rounded-lg border p-1.5 shadow-[0_4px_16px_rgba(74,62,40,0.16)]"
      role="group"
      aria-label="link actions"
    >
      <a
        // A long url would push the actions off the bubble, so it gets an
        // ellipsis and keeps the whole address in its title. Maroon,
        // because it points out of the app — the one thing that colour
        // means on this palette.
        className="text-accent max-w-[150px] overflow-hidden font-sans text-xs text-ellipsis whitespace-nowrap"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // The address is truncated to keep the bubble small, so the whole
        // of it stays available on hover.
        title={href}
      >
        {href}
      </a>
      <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
        edit
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        // unsetLink extends an empty mark range, so a resting cursor is
        // enough — the words do not have to be selected first.
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        remove
      </Button>
    </BubbleMenu>
  );
};
