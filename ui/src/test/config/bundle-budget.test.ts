import { describe, expect, it } from "vitest";
import type { OutputBundle } from "rollup";
import { bundleBudget } from "../../../vite-bundle-budget";

// The build-time ratchet behind issue #272. Route-level code splitting
// landed in #63 and the entry chunk crept back over vite's 500 kB warning
// without anything failing -- a warning does not fail a build. These tests
// cover the plugin's logic; the numbers it is wired up with live in
// vite.config.ts.
//
// Fixtures are deliberately kB-scale, not the hundreds of kB the real
// chunks weigh: a failing assertion pretty-prints whatever it was given,
// and a previous attempt at this file drove a vitest worker to 4.3 GB by
// building 300 kB fixture strings.

/** Vite reports chunk sizes in kB = 1000 bytes, and so does the plugin. */
const KB = 1000;

/** A minimal stand-in for the chunk shape rollup hands to generateBundle. */
function chunk(name: string, sizeInKb: number, code?: string) {
  return {
    type: "chunk" as const,
    name,
    fileName: `assets/${name}-h4sh.js`,
    code: code ?? "x".repeat(Math.round(sizeInKb * KB)),
  };
}

/** A non-chunk output, e.g. the CSS emitted alongside a chunk. */
function asset(fileName: string, sizeInKb: number) {
  return {
    type: "asset" as const,
    fileName,
    source: "y".repeat(Math.round(sizeInKb * KB)),
  };
}

type Output = ReturnType<typeof chunk> | ReturnType<typeof asset>;

/** Drives the plugin's generateBundle hook the way rollup would. */
function check(budgetsInKb: Record<string, number>, outputs: Output[]) {
  const { generateBundle } = bundleBudget(budgetsInKb);
  if (typeof generateBundle !== "function") {
    throw new Error("bundleBudget must expose a generateBundle hook");
  }
  const bundle = Object.fromEntries(outputs.map((o) => [o.fileName, o]));
  generateBundle.call(
    // The hook uses none of rollup's plugin context.
    {} as ThisParameterType<typeof generateBundle>,
    {} as Parameters<typeof generateBundle>[0],
    bundle as unknown as OutputBundle,
    false,
  );
}

/** The message of whatever `check` threw, or "" if it did not throw. */
function messageFrom(run: () => void): string {
  try {
    run();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("bundleBudget", () => {
  // This file lives in the node-environment "config" project (see
  // vitest.workspace.ts): it drives build tooling and never touches the
  // DOM, so it must not pay for a jsdom environment.
  it("runs in a node environment, without a DOM", () => {
    expect(typeof document).toBe("undefined");
  });

  it("only runs during a build, after every other plugin", () => {
    const plugin = bundleBudget({ index: 1 });
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
  });

  it("accepts a build whose chunks are all within budget", () => {
    expect(
      messageFrom(() =>
        check({ index: 4, admin: 5 }, [chunk("index", 3), chunk("admin", 4)]),
      ),
    ).toBe("");
  });

  it("accepts a chunk sitting exactly on its budget", () => {
    expect(
      messageFrom(() => check({ index: 3 }, [chunk("index", 3)])),
    ).toBe("");
  });

  it("rejects an oversized chunk, naming it with both sizes", () => {
    const message = messageFrom(() => check({ index: 4 }, [chunk("index", 5)]));
    expect(message).toContain('"index"');
    expect(message).toContain("5.0 kB");
    expect(message).toContain("4 kB");
  });

  it("reports every oversized chunk, not just the first", () => {
    const message = messageFrom(() =>
      check({ index: 4, admin: 5 }, [chunk("index", 5), chunk("admin", 6)]),
    );
    expect(message).toContain('"index"');
    expect(message).toContain('"admin"');
  });

  it("rejects a build where a budgeted chunk was never emitted", () => {
    // A renamed or deleted entry point would otherwise silently retire its
    // budget, which is how a ratchet quietly stops ratcheting.
    const message = messageFrom(() => check({ index: 4 }, [chunk("admin", 1)]));
    expect(message).toContain('"index"');
    expect(message).toContain("no such chunk");
  });

  it("ignores chunks it has no budget for", () => {
    expect(
      messageFrom(() =>
        check({ index: 4 }, [chunk("index", 1), chunk("auth0-react.esm", 9)]),
      ),
    ).toBe("");
  });

  it("ignores non-chunk assets sharing a budgeted chunk's name", () => {
    expect(
      messageFrom(() =>
        check({ index: 4 }, [
          chunk("index", 1),
          asset("assets/index-h4sh.css", 9),
        ]),
      ),
    ).toBe("");
  });

  it("measures bytes rather than characters", () => {
    // 400 three-byte characters is 1.2 kB, over a 1 kB budget, even though
    // it is only 400 characters long.
    const message = messageFrom(() =>
      check({ index: 1 }, [chunk("index", 0, "あ".repeat(400))]),
    );
    expect(message).toContain('"index"');
  });
});
