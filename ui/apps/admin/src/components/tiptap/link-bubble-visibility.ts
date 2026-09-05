import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Whether the link bubble belongs on screen. A custom predicate replaces
 * the bubble-menu plugin's default outright, so the parts of the default
 * that still apply are repeated here: an editor that is not editable offers
 * no link actions, and the menu has to stay up while one of its own buttons
 * holds focus, or pressing that button would dismiss it before the click
 * landed.
 *
 * What the default would not allow is the case this menu exists for. It
 * refuses an empty selection, and a cursor resting in a link — which is
 * what clicking a link now does, since #682 stopped the click navigating —
 * is exactly that.
 *
 * Lives apart from link-bubble-menu.tsx only because a module that exports
 * both a component and a plain function costs React Fast Refresh the whole
 * file (the same reason link-refusal-message.ts is its own module).
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
