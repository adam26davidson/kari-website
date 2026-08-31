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
import stream from "node:stream";
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
 * `fs.statSync(file)`, or null when it cannot be stat'ed at all.
 *
 * This replaces the `existsSync(f) && statSync(f)` pair it is tempting to
 * write instead. `existsSync` IS a `statSync` with the throw swallowed, so
 * the pair stats twice and still throws whenever the file is unlinked
 * between the two calls — which `npm run build` does to all of dist/ while
 * the preview server is serving it.
 *
 * @param {string} file
 * @returns {fs.Stats | null}
 */
function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/**
 * The file dist/ should answer `pathname` with, or null when nothing
 * matches and the caller should fall back to an index document.
 *
 * Returns null rather than throwing for a path that escapes dist/ (`..`) or
 * one that is not decodable at all (`/%zz`), so both are answered with the
 * SPA shell like any other unknown route. That catch is intended BEHAVIOUR,
 * not a crash guard: `handle` does have a last-resort error boundary above
 * it, but letting an undecodable path reach it would answer an unknown route
 * with a 500 instead of the shell. The tests pin the shell.
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
  return statOrNull(normalized)?.isFile() ? normalized : null;
}

/**
 * The path of a request target, or "/" when the URL parser rejects it.
 *
 * A request target is not a URL, and not every target is even valid as a
 * relative reference: "//" and "//@" are protocol-relative, so parsing them
 * against the origin leaves no host and `new URL` throws — which
 * `curl --path-as-is http://localhost:4173//`, or a raw backslash in the
 * path, is enough to trigger. Falling back to "/" answers such a target with
 * the public shell, exactly like any other route that matches no file —
 * again the intended behaviour rather than a crash guard, so this catch
 * stays even though `handle` has a boundary above it.
 *
 * @param {string} target
 * @returns {string}
 */
function requestPathname(target) {
  try {
    return new URL(target, `http://${host}`).pathname;
  } catch {
    return "/";
  }
}

/** True for the admin app's own URL space. @param {string} pathname */
const isAdminPath = (pathname) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

/**
 * Answer a request that failed, without ever failing again in the process.
 *
 * Both error paths below funnel through here, so it has to cope with a
 * response that is already on its way: a second `writeHead` throws
 * ERR_HTTP_HEADERS_SENT, and writing to a destroyed response emits 'error'
 * on it. Once the status line is gone there is no code left to report with
 * anyway, so all that remains is to cut the connection.
 *
 * @param {http.ServerResponse} response
 * @param {string} what
 * @param {unknown} error
 */
function fail(response, what, error) {
  console.error(`preview: ${what}: ${String(error)}`);
  if (response.headersSent || response.writableEnded || response.destroyed) {
    response.destroy();
    return;
  }
  response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
  response.end(`Internal error: ${what}`);
}

/**
 * Run `body` under the last-resort error boundary, answering 500 if it
 * throws.
 *
 * This is a function rather than one `try` around the createServer callback
 * because a `try` there reaches only the synchronous part of a request: the
 * moment work continues in a later tick — the read stream's 'open' handler
 * below — it is outside that block again, and a throw there is once more an
 * uncaught exception. Every entry point into request handling therefore
 * wraps itself.
 *
 * @param {http.ServerResponse} response
 * @param {string} what
 * @param {() => void} body
 */
function guard(response, what, body) {
  try {
    body();
  } catch (error) {
    fail(response, what, error);
  }
}

/**
 * Stream `file` to `response`.
 *
 * Two things make this more than a `.pipe`. First, the stat that got us here
 * says the file existed a moment ago, not that it can be opened now — `npm
 * run build` empties dist/ (emptyOutDir) while requests are in flight, so it
 * can vanish in between, and permissions can refuse the open outright.
 * Either way fs emits 'error' on the read stream, which `.pipe` does not
 * forward to the destination and which nothing else would be listening for.
 * So the 200 waits for 'open': until the file is known to be readable no
 * headers have been committed, which is what lets an open-time failure be
 * answered with a real 500 instead of a half-sent 200.
 *
 * Second, once bytes are moving, `stream.pipeline` owns the transfer rather
 * than `.pipe`, because it handles errors at BOTH ends — a client that hangs
 * up mid-download errors the destination, and `.pipe` with a source-only
 * 'error' listener would leak the open read stream.
 *
 * @param {string} file
 * @param {http.ServerResponse} response
 */
function sendFile(file, response) {
  const source = fs.createReadStream(file);
  const relative = path.relative(UI_ROOT, file);
  source.once("error", (error) => {
    source.destroy();
    fail(response, `cannot read ${relative}`, error);
  });
  source.once("open", () =>
    guard(response, `cannot serve ${relative}`, () => {
      source.removeAllListeners("error");
      response.writeHead(200, {
        "content-type":
          CONTENT_TYPES[path.extname(file).toLowerCase()] ??
          "application/octet-stream",
        // A preview server, not a CDN: never let a stale asset survive a
        // rebuild.
        "cache-control": "no-store",
      });
      stream.pipeline(source, response, (error) => {
        if (!error) return;
        // The status line is already sent, so there is nothing to say this
        // with. A client that simply hung up is ordinary, not a fault, so it
        // is not worth a line of output either.
        if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          console.warn(`preview: transfer of ${relative} failed: ${error}`);
        }
        response.destroy();
      });
    }),
  );
}

/**
 * Answer one request.
 *
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
function handle(request, response) {
  // A client that disconnects mid-request emits 'error' on the request
  // stream — which nothing here otherwise reads — and can do the same on the
  // response before pipeline takes it over. An 'error' event with no
  // listener is not catchable by anything above; it exits the process.
  request.on("error", (error) => {
    console.warn(`preview: request stream error: ${error}`);
  });
  response.on("error", (error) => {
    console.warn(`preview: response stream error: ${error}`);
  });

  const pathname = requestPathname(request.url ?? "/");
  const fallback = isAdminPath(pathname) ? ADMIN_INDEX : PUBLIC_INDEX;
  const file = resolveFile(pathname) ?? fallback;
  if (!statOrNull(file)?.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(
      `Not found: no ${path.relative(UI_ROOT, file)} — run npm run build`,
    );
    return;
  }
  sendFile(file, response);
}

const server = http.createServer((request, response) => {
  // A last-resort boundary, deliberately not the place anything is *meant*
  // to be handled: every failure this file knows about is dealt with at its
  // own site above, and the per-site catches in resolveFile and
  // requestPathname encode behaviour (an unknown route gets the shell) that
  // a blanket 500 here would hijack. It exists because three review cycles
  // running found a different uncaught throw in this handler, and this
  // server is playwright's webServer: the cost of the next one should be one
  // failed request, not a dead server that fails the whole e2e or screenshot
  // run with ECONNREFUSED.
  guard(response, "request handler failed", () => handle(request, response));
});

server.listen(port, () => {
  console.log(`  ➜  Local:   http://${host}:${port}/`);
});
