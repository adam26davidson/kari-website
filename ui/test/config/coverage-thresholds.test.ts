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
const thresholds = config.test?.coverage?.thresholds;

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
    expect(group).toBeDefined();
    // Floors, not targets: only that each metric has a number, since the
    // numbers themselves move with every ratchet bump.
    expect(typeof group?.lines).toBe("number");
    expect(typeof group?.functions).toBe("number");
    expect(typeof group?.branches).toBe("number");
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
