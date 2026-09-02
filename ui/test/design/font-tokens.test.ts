import { describe, expect, it } from "vitest";
import { declaring, indexRule, declaration } from "./css-rules";

// The family half of the type scale (#483).
//
// The two typefaces used to be spelled out in every stylesheet that wanted
// one — twenty-six literal `font-family` declarations across three
// workspaces, which meant changing a typeface was a sweep rather than an
// edit, and meant nothing could change one at runtime at all. They now go
// through two tokens defined once in the shared index.css:
//
//   --font-body   the reading face, used by `body` and inherited everywhere
//   --font-ui     the interface face, used by controls, panels and notices
//
// That single definition point is what lets useSiteBackground publish an
// admin-chosen pairing as body-level custom properties: setting the token on
// <body> re-points every rule below at once. So a literal creeping back in
// is not just untidy, it is a rule the admin's font choice silently cannot
// reach — which is what these tests are here to catch.

const BODY_TOKEN = "--font-body";
const UI_TOKEN = "--font-ui";

/**
 * The stacks the tokens are defined as: today's exact appearance, and the
 * appearance the site falls back to whenever no pairing is chosen, the
 * settings cannot be fetched, or the stored pairing id is not one we know.
 */
const DEFAULT_STACKS = {
  [BODY_TOKEN]: '"Noto Serif JP", serif',
  [UI_TOKEN]: '"Roboto", sans-serif',
};

const ALLOWED = [`var(${BODY_TOKEN})`, `var(${UI_TOKEN})`];

describe("the family axis of the type scale", () => {
  it.each(declaring("font-family"))(
    "%s names a typeface through a token, not a family name",
    (_label, value) => {
      expect(ALLOWED).toContain(value);
    },
  );

  it("defines both tokens in the shared :root", () => {
    const root = indexRule(":root").block;
    expect(declaration(root, BODY_TOKEN)).toBe(DEFAULT_STACKS[BODY_TOKEN]);
    expect(declaration(root, UI_TOKEN)).toBe(DEFAULT_STACKS[UI_TOKEN]);
  });

  it("uses both tokens — an unused one would rot unnoticed", () => {
    const used = new Set(declaring("font-family").map(([, value]) => value));
    expect([...used].sort()).toEqual([...ALLOWED].sort());
  });

});
