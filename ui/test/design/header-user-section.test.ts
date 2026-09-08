import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The admin bar is one flex row, and its width is decided partly by data:
// the user block shows `user.name` from Auth0, which for an account with no
// display name set IS the email address. At 390px there is no room for one.
// Measured on main with `kari.davidson@example.com`: a 422px row inside a
// 390px viewport, the title squeezed into a three-line stack and the logout
// button pushed off the side of the phone (#573). The seeded e2e account is
// `e2e-ci`, six characters, so neither the suite nor the screenshot check
// ever saw it.
//
// Four rules keep it from coming back, and the first three are worthless
// individually:
//
//   1. the user block may shrink below its content (`min-width: 0`) — an
//      email is one unbreakable word, so its min-content size is the whole
//      thing and the block otherwise refuses to give;
//   2. the name itself may shrink and truncates when it does, rather than
//      wrapping or spilling;
//   3. the title does NOT shrink, so the name is what gives. Flex shrinking
//      is proportional to base size, so without this the title wraps while a
//      long name still shows in full — the wrong one of the two gave;
//   4. below 768px the name is not shown at all: there is room for the
//      title, the person icon and the logout button and nothing else. It is
//      hidden the accessible way, so a screen reader still announces who is
//      signed in.
//
// Asserted on what the stylesheet declares, not on a computed layout: jsdom
// lays nothing out, and a rendered-width assertion would need a browser the
// unit suite does not have. The verification that these declarations
// actually produce a 390px row is in the PR for #573, measured in Chromium.

const HEADER_CSS = "packages/shared/src/styles/header.css";
const PHONE = "@media (max-width: 767.98px)";

/** The one rule in header.css with this selector and these at-rules. */
function rule(selector: string, atRules: string[] = []) {
  const matches = RULES.filter(
    (candidate) =>
      candidate.file === HEADER_CSS &&
      candidate.selector === selector &&
      candidate.atRules.join(" ") === atRules.join(" "),
  );
  expect(matches.map(label)).toHaveLength(1);
  return matches[0].block;
}

describe("the admin bar's user block", () => {
  it("may shrink below the width of the name it is showing", () => {
    expect(declaration(rule(".header-user-section"), "min-width")).toBe("0");
  });

  it("keeps the name on one line and truncates it with an ellipsis", () => {
    const block = rule(".header-user-name");
    expect(declaration(block, "min-width")).toBe("0");
    expect(declaration(block, "white-space")).toBe("nowrap");
    expect(declaration(block, "overflow")).toBe("hidden");
    expect(declaration(block, "text-overflow")).toBe("ellipsis");
  });

  it("makes the name give before the title does", () => {
    expect(declaration(rule(".admin-header-title"), "flex-shrink")).toBe("0");
  });

  it("takes the name out of the phone bar's flex row entirely", () => {
    const block = rule(".admin-header .header-user-name", [PHONE]);
    expect(declaration(block, "position")).toBe("absolute");
    expect(declaration(block, "margin")).toBe("0px");
  });

  // `display: none` and `visibility: hidden` would take the name out of the
  // accessibility tree with it, leaving a phone screen-reader user with an
  // unlabelled icon and a button where every other width says who is signed
  // in. The clip is what makes hiding it a visual decision only.
  it("keeps the hidden name available to assistive technology", () => {
    const block = rule(".admin-header .header-user-name", [PHONE]);
    expect(declaration(block, "clip-path")).toBe("inset(50%)");
    expect(declaration(block, "display")).toBeUndefined();
    expect(declaration(block, "visibility")).toBeUndefined();
  });

  // The stylesheet is shared by both bars since the workspace split, and the
  // public bar has no user block: every phone-width rule here is a claim
  // about the admin bar and must say so, or the next one silently reflows
  // the public header too.
  it("scopes every phone-width rule in header.css to the admin bar", () => {
    const phoneRules = RULES.filter(
      (candidate) =>
        candidate.file === HEADER_CSS && candidate.atRules.includes(PHONE),
    );
    expect(phoneRules.length).toBeGreaterThan(0);
    expect(
      phoneRules
        .filter((phoneRule) => !phoneRule.selector.startsWith(".admin-header"))
        .map(label),
    ).toEqual([]);
  });
});
