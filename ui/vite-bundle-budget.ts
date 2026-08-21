import type { Plugin } from "vite";

/** Vite reports chunk sizes in kB = 1000 bytes; budgets use the same unit
 * so the numbers below can be read straight off a build log. */
const KB = 1000;

/**
 * Fails the build when a named output chunk grows past its byte budget.
 *
 * Vite's own `chunkSizeWarningLimit` only warns, which is exactly how the
 * entry chunk drifted from "small enough to close #63" back up to 514 kB
 * without anything noticing (issue #272). Budgets here work like the
 * coverage floors in `vitest.config.ts`: pinned just above the current
 * size, so a regression is loud, and raised deliberately in the same PR
 * that justifies the growth.
 *
 * Budgets are keyed by rollup chunk name -- the part of the filename
 * before the content hash, which is what vite prints in the build log. A
 * budget whose chunk never appears is itself an error: a renamed or
 * deleted entry point must not silently retire its ratchet.
 *
 * Sizes are measured on the generated code, which runs a hair under the
 * size vite prints for the file it writes; budgets carry far more headroom
 * than that gap, so it makes no practical difference.
 *
 * @param budgetsInKb chunk name -> maximum size in kB (1000 bytes)
 */
export function bundleBudget(budgetsInKb: Record<string, number>): Plugin {
  return {
    name: "bundle-budget",
    apply: "build",
    // Last, so what gets measured is what vite writes: several core
    // plugins still add to a chunk from their own generateBundle (the
    // preload dependency map, for one).
    enforce: "post",
    generateBundle(_options, bundle) {
      const sizes = new Map<string, number>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        if (!(output.name in budgetsInKb)) continue;
        sizes.set(output.name, Buffer.byteLength(output.code, "utf8"));
      }

      const problems: string[] = [];
      for (const [name, budgetInKb] of Object.entries(budgetsInKb)) {
        const size = sizes.get(name);
        if (size === undefined) {
          problems.push(
            `"${name}" has a ${budgetInKb} kB budget but no such chunk ` +
              `was emitted -- rename or remove its entry in vite.config.ts.`,
          );
        } else if (size > budgetInKb * KB) {
          problems.push(
            `"${name}" is ${(size / KB).toFixed(1)} kB, over its ` +
              `${budgetInKb} kB budget.`,
          );
        }
      }

      if (problems.length > 0) {
        throw new Error(
          `Bundle budget exceeded:\n  ${problems.join("\n  ")}\n` +
            `Move the growth into a lazily loaded chunk, or raise the ` +
            `budget in vite.config.ts and say why in the PR.`,
        );
      }
    },
  };
}
