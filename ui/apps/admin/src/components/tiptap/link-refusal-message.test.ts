import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { LINK_EXAMPLES, linkRefusedMessage } from "./link-refusal-message";

// Each test drives a real editor rather than a stub: the whole point of
// the module is that the message agrees with the extension that produced
// the refusal, so a stubbed allow-list would test nothing.
let editor: Editor | null = null;

// @tiptap/extension-link is a transitive dependency of StarterKit, not one
// this workspace declares, so its LinkOptions type is not importable here.
// The narrower context type is assignable to the extension's own.
type IsAllowedUri = (
  url: string,
  ctx: { defaultValidate: (url: string) => boolean },
) => boolean;

const makeEditor = (isAllowedUri?: IsAllowedUri) => {
  editor = new Editor({
    // Omit the key rather than pass `{ isAllowedUri }`: an explicit
    // undefined replaces the extension's default validator instead of
    // leaving it alone, and the editor then throws on the first href it
    // checks.
    extensions: [
      StarterKit.configure({ link: isAllowedUri ? { isAllowedUri } : {} }),
    ],
    content: "<p>hello</p>",
  });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("linkRefusedMessage", () => {
  it("names every example the extension's own allow-list accepts", () => {
    // The pin the hand-written message lacked: if a tiptap bump drops
    // mailto: or relative URLs from the Link defaults, this fails instead
    // of the popover quietly recommending a URL it would then refuse.
    expect(linkRefusedMessage(makeEditor())).toBe(
      "That link was not applied. Try a web address like " +
        "https://example.com, an email address like " +
        "mailto:hello@example.com or a page on this site like /haiku.",
    );
  });

  it("drops an example the editor is configured to refuse", () => {
    const message = linkRefusedMessage(
      makeEditor(
        (url, { defaultValidate }) =>
          defaultValidate(url) && !url.startsWith("mailto:"),
      ),
    );

    expect(message).toBe(
      "That link was not applied. Try a web address like " +
        "https://example.com or a page on this site like /haiku.",
    );
  });

  it("offers a lone survivor without a list", () => {
    const message = linkRefusedMessage(
      makeEditor((url) => url.startsWith("https:")),
    );

    expect(message).toBe(
      "That link was not applied. Try a web address like " +
        "https://example.com.",
    );
  });

  it("says what happened when the editor accepts none of the examples", () => {
    expect(linkRefusedMessage(makeEditor(() => false))).toBe(
      "That link was not applied. That kind of address cannot be used here.",
    );
  });

  it("offers examples the editor would really accept", () => {
    const live = makeEditor();

    for (const { href } of LINK_EXAMPLES) {
      expect(live.can().setLink({ href })).toBe(true);
    }
  });
});
