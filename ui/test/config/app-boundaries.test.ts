import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The point of splitting the admin into its own app (#591) is that a
// visitor to the public site downloads none of it: no Auth0 SDK, no tiptap
// editor stack, no admin page code. Nothing enforces that at runtime —
// npm hoists every workspace's dependencies into ONE node_modules, so an
// `import "@auth0/auth0-react"` from a public component resolves happily
// and ships. The bundle budget in apps/public/vite.config.ts would notice
// the weight eventually, but only once it exceeded the 25 kB of headroom
// that exists for Renovate's sake, and it would name a size rather than
// the import that caused it.
//
// So the boundary is asserted here, at its narrowest: which modules each
// app is allowed to reach for. It is a source check, not a bundle check —
// which is what makes the failure legible ("this file imports that") and
// what lets it run in milliseconds on every test run.

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every non-test source file under `dir`, as ui-relative paths. */
function sourceFiles(dir: string): string[] {
  return readdirSync(`${UI_ROOT}${dir}`, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile()) return [];
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    },
  );
}

/** Every module specifier imported (statically or dynamically) by a file. */
function importsOf(path: string): string[] {
  const source = readFileSync(`${UI_ROOT}${path}`, "utf-8");
  return [
    ...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

/** [file, specifier] for every import in every source file under `dir`. */
const importsUnder = (dir: string): Array<[string, string]> =>
  sourceFiles(dir).flatMap((file) =>
    importsOf(file).map((specifier) => [file, specifier] as [string, string]),
  );

const PUBLIC_IMPORTS = importsUnder("apps/public/src");
const SHARED_IMPORTS = importsUnder("packages/shared/src");

/**
 * Packages only the admin app may depend on: the Auth0 SDK it authenticates
 * with, and the tiptap editor stack behind the blog-post editor. Together
 * they were most of the weight #272 fought to keep out of the entry chunk.
 */
const ADMIN_ONLY_PACKAGES = [
  "@auth0/auth0-react",
  "@tiptap/starter-kit",
  "@tiptap/react",
  "@tiptap/pm",
  "@tiptap/extension-image",
  "@tiptap/extension-link",
  "@tiptap/extension-text-align",
];

/** Whether `specifier` is (or is a subpath of) `pkg`. */
const isFrom = (specifier: string, pkg: string) =>
  specifier === pkg || specifier.startsWith(`${pkg}/`);

describe("the public app's dependency boundary", () => {
  it("finds the public app's source files", () => {
    // A scan that stopped seeing the app would pass every assertion below.
    expect(PUBLIC_IMPORTS.length).toBeGreaterThan(20);
  });

  it.each(ADMIN_ONLY_PACKAGES)("never imports %s", (pkg) => {
    const offenders = PUBLIC_IMPORTS.filter(([, specifier]) =>
      isFrom(specifier, pkg),
    ).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("never reaches into the admin app", () => {
    const offenders = PUBLIC_IMPORTS.filter(
      ([, specifier]) =>
        isFrom(specifier, "@kari/admin") || specifier.includes("apps/admin"),
    ).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("imports the shared package by name, never by relative path", () => {
    // `../../packages/shared/...` would work in vite and defeat the point:
    // the package boundary is what keeps the split honest.
    const offenders = PUBLIC_IMPORTS.filter(([, specifier]) =>
      specifier.includes("packages/shared"),
    ).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe("the shared package's dependency boundary", () => {
  it("finds the shared package's source files", () => {
    expect(SHARED_IMPORTS.length).toBeGreaterThan(20);
  });

  // Anything the shared package imports is imported by BOTH apps, so an
  // admin-only dependency landing here would put it back in the public
  // bundle by the back door.
  it.each(ADMIN_ONLY_PACKAGES)("never imports %s", (pkg) => {
    const offenders = SHARED_IMPORTS.filter(([, specifier]) =>
      isFrom(specifier, pkg),
    ).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("never reaches back into either app", () => {
    const offenders = SHARED_IMPORTS.filter(
      ([, specifier]) =>
        specifier.startsWith("@kari/") || specifier.includes("apps/"),
    ).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
