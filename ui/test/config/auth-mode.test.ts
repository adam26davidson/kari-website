import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

// The fake Auth0 session (#266) is a dev/test convenience, and its whole
// safety argument is that the flag selecting it is set in exactly two env
// files. `admin-auth.tsx` folds the branch away — and vite tree-shakes
// `fake-auth.tsx` out of the bundle — only when VITE_AUTH_MODE is UNSET at
// build time, so "which modes set it" is the invariant, not a detail.
//
// CI also greps the built dist/ for the fake's constants, but that check
// lives in a workflow and runs after a full build. This one runs on every
// unit test run, in milliseconds, and names the env file if someone adds
// the flag to the wrong one.

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** What a build in `mode` actually sees, from the real env files. */
function authMode(mode: string): string | undefined {
  return loadEnv(mode, UI_ROOT, "VITE_").VITE_AUTH_MODE;
}

beforeAll(() => {
  // loadEnv merges process.env's VITE_-prefixed vars over the files, so a
  // developer who exported VITE_AUTH_MODE in their shell would otherwise
  // read their own environment back instead of the repo's.
  delete process.env.VITE_AUTH_MODE;
});

describe("VITE_AUTH_MODE across build modes", () => {
  it.each(["development", "test"])(
    "enables the fake admin session in %s builds",
    (mode) => {
      expect(authMode(mode)).toBe("fake");
    },
  );

  // `.env` is loaded in EVERY mode, so these two also prove the shared
  // file never sets the flag.
  it.each(["staging", "production"])(
    "leaves it unset in %s builds, so the fake folds away",
    (mode) => {
      expect(authMode(mode)).toBeUndefined();
    },
  );
});
