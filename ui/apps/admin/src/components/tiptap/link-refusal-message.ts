import type { Editor } from "@tiptap/react";

// What the popover says when the Link extension refuses an href for what
// it is (a scheme outside the allow-list) rather than for where it lands.
//
// The allow-list is not a constant this file can read: it is the
// extension's own defaults plus whatever `protocols` StarterKit is
// configured with in tiptap.tsx, and the defaults themselves move on a
// tiptap bump. A message that spelled the list out by hand drifted from
// the editor silently, because nothing failed when it did. So every
// example below is offered to the live editor first and named only if the
// editor would in fact accept it.
//
// The examples are deliberately not the whole allow-list -- the extension
// also takes ftp, sms, xmpp and friends, none of which belong in a
// suggestion to the author of a poetry site. The message therefore
// suggests rather than enumerates, so it stays true when the allow-list
// grows as well as when it shrinks.
interface LinkExample {
  // How the example is introduced, in the author's words.
  lead: string;
  // Shown to the author verbatim, and used as the probe URL, so the two
  // cannot come apart.
  href: string;
}

export const LINK_EXAMPLES: LinkExample[] = [
  { lead: "a web address like", href: "https://example.com" },
  { lead: "an email address like", href: "mailto:hello@example.com" },
  { lead: "a page on this site like", href: "/haiku" },
];

const REFUSAL = "That link was not applied.";
const NOTHING_TO_SUGGEST = `${REFUSAL} That kind of address cannot be used here.`;

// "a, b or c" -- and just "a" when the editor left only one suggestion
// standing. Never called with none; the caller says something else then.
const joinWithOr = (phrases: string[]) =>
  phrases.length < 2
    ? phrases.join("")
    : `${phrases.slice(0, -1).join(", ")} or ${phrases[phrases.length - 1]}`;

export const linkRefusedMessage = (editor: Editor): string => {
  const suggestions = LINK_EXAMPLES.filter(({ href }) =>
    editor.can().setLink({ href }),
  ).map(({ lead, href }) => `${lead} ${href}`);

  return suggestions.length === 0
    ? NOTHING_TO_SUGGEST
    : `${REFUSAL} Try ${joinWithOr(suggestions)}.`;
};
