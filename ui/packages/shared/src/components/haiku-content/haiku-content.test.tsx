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
  // matching the ".haiku-list-line-compact" rule below it.
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

  it("switches to the compact classes in the admin list", () => {
    const { container } = render(<HaikuContent haiku={haiku} compact={true} />);
    expect(container.querySelectorAll(".haiku-list-line-compact")).toHaveLength(
      haiku.lines.length,
    );
    expect(
      container.querySelector(".haiku-list-publisher-compact"),
    ).toBeInTheDocument();
  });

  // The poem centred in the page is the public presentation and stays that
  // way; centred in an ADMIN list row it left the row's first third empty
  // and made haiku the one section whose entries did not start where every
  // other section's title starts (#457, design brief §1).
  it("centres the poem on the public page and left-aligns it in the admin row", () => {
    expect(alignment("haiku-list-line")).toBe("center");
    expect(alignment("haiku-list-publisher")).toBe("center");
    expect(alignment("haiku-list-line-compact")).toBe("left");
    expect(alignment("haiku-list-publisher-compact")).toBe("left");
  });
});
