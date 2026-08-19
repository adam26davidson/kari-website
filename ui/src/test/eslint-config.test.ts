import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// `npm run lint` runs eslint with --report-unused-disable-directives over the
// whole package, so any generated directory left behind by another script
// becomes lint input. The istanbul HTML reporter that `npm run test:coverage`
// writes into coverage/ ships vendored scripts carrying `/* eslint-disable */`
// headers, which that flag reports as errors. Running coverage before lint is
// the documented local sequence (CLAUDE.md), so these directories must stay
// ignored.
describe("eslint config ignore patterns", () => {
  const eslint = new ESLint();

  it.each([
    "coverage/block-navigation.js",
    "coverage/prettify.js",
    "coverage/sorter.js",
    "dist/assets/index.js",
  ])("ignores generated file %s", async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(true);
  });

  it("still lints application source", async () => {
    await expect(eslint.isPathIgnored("src/main.tsx")).resolves.toBe(false);
  });
});
