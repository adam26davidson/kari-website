import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { HaikuContent } from "./haiku-content";
import { Haiku } from "../../models";

const haiku: Haiku = {
  id: "h1",
  lines: ["an old silent pond", "a frog jumps into the pond", "splash"],
  publisher: "Matsuo Basho",
};

// jsdom applies no stylesheet, so the alignment is read out of the CSS
// rather than measured.
const css = readFileSync(
  "packages/shared/src/components/haiku-content/haiku-content.css",
  "utf-8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The `text-align` of the rule for exactly `className`. */
const alignment = (className: string) => {
  // `\s*\{` and not `[-\w]*` — it is what keeps ".haiku-list-line" from
  // matching a longer rule name that merely starts with it.
  const rule = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  expect(rule, `no rule for .${className}`).not.toBeNull();
  return rule![1].match(/text-align\s*:\s*(\w+)/)?.[1];
};

describe("HaikuContent", () => {
  it("renders every line and the publisher", () => {
    render(<HaikuContent haiku={haiku} />);
    for (const line of haiku.lines) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(screen.getByText("Matsuo Basho")).toBeInTheDocument();
  });

  // The poem centred in the page is the public presentation: the column is
  // drawn around it and the centring IS the page. The admin list renders
  // its own left-aligned serif rows instead (#457, design brief §1), so
  // this component only ever has the one, centred, presentation.
  it("centres the poem and its attribution on the public page", () => {
    expect(alignment("haiku-list-line")).toBe("center");
    expect(alignment("haiku-list-publisher")).toBe("center");
  });
});
