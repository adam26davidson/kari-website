// The static server behind `npm run preview`.
//
// It stands in for `vite preview`, which cannot serve the two-app dist/ that
// scripts/build-apps.mjs produces: vite preview has exactly one SPA fallback
// document, so a deep link like /admin/haiku/seed-haiku-1 (which
// e2e/screenshots.mjs and the admin e2e journeys request directly) would be
// answered with the PUBLIC index.html and render the public site instead of
// the admin app.
//
// The rule here is the one the deployed nginx vhost will get in #593:
//
//   /admin, /admin/...   -> dist/admin/index.html when no file matches
//   everything else      -> dist/index.html when no file matches
//
// This is deliberately a throwaway: #593 replaces it with the prod-like
// arrangement (a second document root and the real nginx config), at which
// point this file goes away.
//
// Usage: node scripts/serve.mjs [--port 4173] [--host 127.0.0.1]
// `--strictPort` is accepted and ignored — the port here is never negotiated,
// so the flag playwright.config.ts passes to `npm run preview` is already the
// behaviour.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(UI_ROOT, "dist");
const PUBLIC_INDEX = path.join(DIST, "index.html");
const ADMIN_INDEX = path.join(DIST, "admin", "index.html");

/**
 * The value following `flag` on the command line, if present.
 *
 * @param {string} flag
 * @returns {string | undefined}
 */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(argValue("--port") ?? process.env.PORT ?? 4173);
const host = argValue("--host") ?? "localhost";

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * The file dist/ should answer `pathname` with, or null when nothing
 * matches and the caller should fall back to an index document.
 *
 * Returns null rather than throwing for a path that escapes dist/ (`..`) or
 * one that is not decodable at all (`/%zz`), so both are answered with the
 * SPA shell like any other unknown route. The second case matters more than
 * it looks: this handler has no error boundary above it, so a throw here is
 * an uncaught exception that kills the process — and this server is
 * playwright's webServer, so one stray request would fail the rest of an e2e
 * or screenshot run with ECONNREFUSED.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = path.join(DIST, decoded);
  const normalized = path.normalize(candidate);
  if (normalized !== DIST && !normalized.startsWith(DIST + path.sep)) {
    return null;
  }
  return fs.existsSync(normalized) && fs.statSync(normalized).isFile()
    ? normalized
    : null;
}

/** True for the admin app's own URL space. @param {string} pathname */
const isAdminPath = (pathname) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
  const fallback = isAdminPath(pathname) ? ADMIN_INDEX : PUBLIC_INDEX;
  const file = resolveFile(pathname) ?? fallback;
  if (!fs.existsSync(file)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(
      `Not found: no ${path.relative(UI_ROOT, file)} — run npm run build`,
    );
    return;
  }
  response.writeHead(200, {
    "content-type":
      CONTENT_TYPES[path.extname(file).toLowerCase()] ??
      "application/octet-stream",
    // A preview server, not a CDN: never let a stale asset survive a rebuild.
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(response);
});

server.listen(port, () => {
  console.log(`  ➜  Local:   http://${host}:${port}/`);
});
