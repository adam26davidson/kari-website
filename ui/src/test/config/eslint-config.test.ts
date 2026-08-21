import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";

// `npm run lint` runs eslint with --report-unused-disable-directives over the
// whole package, so any generated directory left behind by another script
// becomes lint input. The istanbul HTML reporter that `npm run test:coverage`
// writes into coverage/ ships vendored scripts carrying `/* eslint-disable */`
// headers, which that flag reports as errors. Running coverage before lint is
// the documented local sequence (CLAUDE.md), so these directories must stay
// ignored.
//
// eslint.config.js derives its ignore list from .gitignore so the two lists
// cannot drift; these tests assert the derivation rather than a hand-copied
// list of paths, so a directory added to .gitignore is covered automatically.
const gitignorePatterns = readFileSync(".gitignore", "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

// Literal (non-glob, non-negated) entries name a directory or file outright,
// so `<entry>/probe.js` is unambiguously generated output.
const literalPatterns = gitignorePatterns.filter(
  (pattern) => !pattern.startsWith("!") && !/[*?[\]]/.test(pattern),
);

describe("eslint config ignore patterns", () => {
  const eslint = new ESLint();

  // This file lives in the node-environment "config" project (see
  // vitest.workspace.ts): it drives ESLint's own API and never touches the
  // DOM, so it must not pay for a jsdom environment. Asserting the absence of
  // a DOM global keeps it from silently drifting back into the jsdom project.
  it("runs in a node environment, without a DOM", () => {
    expect(typeof document).toBe("undefined");
  });

  it("finds literal ignore entries to check", () => {
    expect(literalPatterns.length).toBeGreaterThan(5);
  });

  it.each(literalPatterns)(
    "ignores %s, which .gitignore lists as generated",
    async (pattern) => {
      await expect(eslint.isPathIgnored(`${pattern}/probe.js`)).resolves.toBe(
        true,
      );
    },
  );

  it.each([
    "coverage/block-navigation.js",
    "coverage/prettify.js",
    "coverage/sorter.js",
    "dist/assets/index.js",
  ])("ignores generated file %s", async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(true);
  });

  it.each(["src/main.tsx", "e2e/screenshots.mjs", "eslint.config.js"])(
    "still lints checked-in source %s",
    async (path) => {
      await expect(eslint.isPathIgnored(path)).resolves.toBe(false);
    },
  );
});
