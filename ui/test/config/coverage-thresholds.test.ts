import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

// The coverage ratchet has TWO layers (#593): whole-run floors, plus a floor
// group per workspace for apps/public, apps/admin and packages/shared. They
// are not redundant, because vitest's glob groups are not a partition of the
// measured files — `resolveThresholds` (vitest/dist/coverage.js) builds one
// coverage map per glob from the files that glob matches, and a `global` map
// it fills from EVERY measured file, leftovers or not. So each layer catches
// something the other cannot:
//
// - Without the per-workspace groups, one workspace's regression hides behind
//   another's headroom — the admin app is a third of the source and could
//   shed several points of branch coverage while the run total moved by a
//   fraction.
// - Without the whole-run floors, any source file no glob names is measured,
//   counted in the PR coverage comment, and policed by nothing. A fourth
//   workspace under the coverage `include` (`apps/*/src/**`) is exactly that
//   case, and it arrives silently: nothing fails, the number just stops
//   meaning what it used to.
//
// Both layers are asserted here rather than trusted, because a threshold can
// be present and still enforce nothing: a glob that matches nothing passes
// VACUOUSLY (vitest resolves these globs against its root, ui/, and reports
// no error for a group with no files, so `apps/publik/src/**` would look like
// enforcement while being none).
//
// The config module is imported directly (like the other tests in here drive
// real tooling rather than a copy of it), so what is asserted is the object
// vitest itself will read.
//
// `coverage` is a union over the providers, and the custom-provider arm has
// no `thresholds` at all, so the property is narrowed to rather than read off
// the union. `thresholds` is then itself a union of "whole-run floors" and
// "glob-keyed groups"; it is widened to a plain record here because the
// config uses both at once, which neither arm of that union describes, and
// the static type would otherwise decide the question before a single
// assertion ran.
// (An `interface` has no index signature, so the widening is a cast rather
// than an annotation.)
const coverage = config.test?.coverage;
const thresholds = (
  coverage && "thresholds" in coverage ? coverage.thresholds : undefined
) as Record<string, unknown> | undefined;

/** The workspaces the coverage `include` in vitest.config.ts spans. */
const WORKSPACES = ["apps/public", "apps/admin", "packages/shared"];

/** Vitest's whole-run metric keys; every other key is read as a glob. */
const METRICS = ["lines", "functions", "branches"];

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

  it("has a glob group for every workspace and no others", () => {
    const globs = Object.keys(thresholds ?? {}).filter(
      (key) => !METRICS.includes(key),
    );
    expect(globs.sort()).toEqual(
      WORKSPACES.map((workspace) => `${workspace}/src/**`).sort(),
    );
  });

  it("keeps whole-run floors as a backstop for files no glob names", () => {
    for (const metric of METRICS) {
      expect(thresholds?.[metric]).toEqual(expect.any(Number));
    }
  });
});
