import { describe, it, expect } from "vitest";

// The config builds its Auth0-gated projects only when the credentials are
// in the environment, so without this the three admin patterns would not
// exist to check on the machines that matter most — CI's unit job and any
// developer's laptop. Set before the import because the config reads them
// as it is evaluated, and only fills a blank: a real value stays, and
// nothing here ever tries to log in.
process.env.E2E_AUTH0_USERNAME ||= "e2e-spec-patterns";
process.env.E2E_AUTH0_PASSWORD ||= "e2e-spec-patterns";
const { default: config } = await import("../../playwright.config");

/**
 * Playwright matches `testMatch` / `testIgnore` against a spec's ABSOLUTE
 * path, so a pattern meant to name a FILE can silently match a DIRECTORY
 * higher up the path instead. That has already happened once: a worktree
 * named `kari-website-admin-shadcn-shell` made the visitor project's
 * `/admin-.*\.spec\.ts/` ignore every spec in the repo, and
 * `npm run test:e2e` exited "No tests found" — the worst possible failure
 * for a suite, a green-looking run that tested nothing.
 *
 * `playwright.config.ts` fixes that with a `SPEC()` helper that anchors
 * each pattern to the last path segment. These tests pin the guarantee
 * rather than the helper, because the anchoring is only half of it: a `.`
 * or `.*` INSIDE a pattern matches `/` too, so an anchored pattern that
 * uses one still reaches across segments. Both halves have to hold, and
 * only the built config knows whether they do.
 */

/** The project of the given name, as playwright would resolve it. */
function project(name: string) {
  const found = config.projects?.find((p) => p.name === name);
  expect(found, `no "${name}" project in playwright.config.ts`).toBeDefined();
  return found!;
}

/**
 * A repo checked out at `root`, with the four spec paths that exist. The
 * directory name is the whole point: these tests ask what happens when it
 * is hostile.
 */
function specsUnder(root: string) {
  return {
    visitor: `${root}/ui/e2e/visitor.spec.ts`,
    smoke: `${root}/ui/e2e/smoke.spec.ts`,
    journeys: `${root}/ui/e2e/admin-journeys.spec.ts`,
    status: `${root}/ui/e2e/admin-whats-on-test.spec.ts`,
  };
}

/** Every project's patterns, whether or not the auth-gated ones are built. */
function patterns() {
  return config.projects!.flatMap((p) =>
    [p.testMatch, p.testIgnore].filter((v): v is RegExp => v instanceof RegExp),
  );
}

describe("e2e spec patterns", () => {
  // The regression itself: the visitor project must run the credential-free
  // specs and skip the admin ones, from ANY checkout directory.
  it.each([
    "/home/dev/kari-website",
    // The worktree that first broke it (#592).
    "/home/dev/kari-website-admin-shadcn-shell",
    // A directory whose name literally starts with "admin-", which anchoring
    // alone does not survive — `[\\/]admin-.*\.spec\.ts$` matches this.
    "/home/dev/admin-tweaks",
    // ...and one that IS the word, so the separator sits right against it.
    "/home/dev/admin-",
  ])("keeps the visitor project's selection stable under %s", (root) => {
    const ignore = project("visitor").testIgnore as RegExp;
    const specs = specsUnder(root);

    expect(ignore.test(specs.visitor), specs.visitor).toBe(false);
    expect(ignore.test(specs.smoke), specs.smoke).toBe(false);
    expect(ignore.test(specs.journeys), specs.journeys).toBe(true);
    expect(ignore.test(specs.status), specs.status).toBe(true);
  });

  // The rule that makes the above hold, stated once so a pattern added
  // later cannot quietly reintroduce the bug in a project these tests do
  // not name. `.` and `.*` match a path separator; `[^\\/]*` does not.
  it("uses no separator-crossing wildcard in any project's pattern", () => {
    for (const pattern of patterns()) {
      expect(pattern.source, `${pattern} may cross a path separator`).not.toMatch(
        /(?<!\\)\./,
      );
    }
  });

  // Anchoring, the other half: a pattern that is not pinned to the end of
  // the path and to a separator in front is a directory matcher waiting to
  // happen.
  it("anchors every pattern to the last path segment", () => {
    for (const pattern of patterns()) {
      expect(pattern.source.startsWith("[\\\\/]"), `${pattern}`).toBe(true);
      expect(pattern.source.endsWith("$"), `${pattern}`).toBe(true);
    }
  });
});
