import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

// The coverage ratchet is enforced PER WORKSPACE (#593): one vitest run, but
// a floor for apps/public, apps/admin and packages/shared each, so a drop in
// one cannot hide behind the others' headroom. A single whole-run number let
// exactly that happen — the admin app is a third of the source, and it could
// shed several points of branch coverage while the total moved by a fraction.
//
// Two failure modes make this worth asserting rather than trusting:
//
// - A glob that matches nothing passes VACUOUSLY. Vitest resolves threshold
//   globs against its root (ui/), and reports no error for a group with no
//   files, so `apps/publik/src/**` would enforce nothing at all while looking
//   like enforcement.
// - Vitest applies glob groups to their matching files and the top-level
//   floors to *whatever is left over*. These globs cover the whole coverage
//   `include`, so top-level floors would police an empty set: present,
//   passing, and meaningless. Their absence is deliberate, and this pins it.
//
// The config module is imported directly (like the other tests in here drive
// real tooling rather than a copy of it), so what is asserted is the object
// vitest itself will read.
//
// `coverage` is a union over the providers, and the custom-provider arm has
// no `thresholds` at all, so the property is narrowed to rather than read off
// the union. `thresholds` is then itself a union of "whole-run floors" and
// "glob-keyed groups"; it is widened to a plain record here because which of
// the two shapes it is IS the thing under test, and the static type would
// otherwise decide the question before a single assertion ran.
// (An `interface` has no index signature, so the widening is a cast rather
// than an annotation.)
const coverage = config.test?.coverage;
const thresholds = (
  coverage && "thresholds" in coverage ? coverage.thresholds : undefined
) as Record<string, unknown> | undefined;

/** The workspaces the coverage `include` in vitest.config.ts spans. */
const WORKSPACES = ["apps/public", "apps/admin", "packages/shared"];

describe("coverage thresholds", () => {
  it("runs in a node environment, without a DOM", () => {
    expect(typeof document).toBe("undefined");
  });

  it("is configured", () => {
    expect(thresholds).toBeDefined();
  });

  it.each(WORKSPACES)("sets a floor group for %s", (workspace) => {
    const group = thresholds?.[`${workspace}/src/**`];
    // Floors, not targets: only that each metric has a number, since the
    // numbers themselves move with every ratchet bump.
    expect(group).toMatchObject({
      lines: expect.any(Number),
      functions: expect.any(Number),
      branches: expect.any(Number),
    });
  });

  it("has a group for every workspace and no others", () => {
    expect(Object.keys(thresholds ?? {}).sort()).toEqual(
      WORKSPACES.map((workspace) => `${workspace}/src/**`).sort(),
    );
  });

  it("sets no whole-run floors, which would police an empty file set", () => {
    for (const metric of ["lines", "functions", "branches", "statements"]) {
      expect(thresholds).not.toHaveProperty(metric);
    }
  });
});
