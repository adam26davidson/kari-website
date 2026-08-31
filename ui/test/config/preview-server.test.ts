import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/serve.mjs backs `npm run preview`, which is playwright's webServer
// for `npm run test:e2e` and for the visual-review capture. It therefore has
// to survive whatever is aimed at the port it binds: one uncaught throw in
// the request handler takes the process down, and every later request in the
// run then fails with ECONNREFUSED — a misleading symptom for a crash a
// single stray URL caused.
//
// These tests drive the real server as a subprocess rather than importing it,
// because what they pin is an *uncaught exception in the http handler*: only
// a real process can be observed to survive one.

const UI_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const SERVE = path.join(UI_ROOT, "scripts", "serve.mjs");

/** A port nothing is listening on, so parallel runs don't collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "localhost", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

let server: ChildProcess;
let origin: string;

beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  server = spawn(process.execPath, [SERVE, "--port", String(port)], {
    cwd: UI_ROOT,
    stdio: "ignore",
  });
  // Poll rather than wait on stdout: the ready line is printed by listen()'s
  // callback, but the socket is what the tests actually need.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(origin + "/");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("preview server never started");
}, 20_000);

afterAll(() => {
  server?.kill();
});

describe("the preview server", () => {
  // dist/ may or may not exist when this runs (the unit suite is run without
  // a build in CI), so assert on what holds either way: a path that resolves
  // to no file is answered exactly like "/" is.
  it("answers a malformed percent-escape like any other unknown route", async () => {
    const shell = await fetch(origin + "/");
    const malformed = await fetch(origin + "/%zz");

    expect(malformed.status).toBe(shell.status);
    expect(await malformed.text()).toBe(await shell.text());
  });

  it("stays up after a malformed percent-escape", async () => {
    await fetch(origin + "/%zz");

    await expect(fetch(origin + "/")).resolves.toBeDefined();
    expect(server.exitCode).toBeNull();
  });

  it("stays up for an escape that decodes to a NUL byte", async () => {
    await fetch(origin + "/%00");

    await expect(fetch(origin + "/")).resolves.toBeDefined();
    expect(server.exitCode).toBeNull();
  });

  // The request target is not a URL, and some of them are not even valid as
  // relative references: "//" and "//@" are protocol-relative, so parsing
  // them against http://localhost yields no host and throws. `curl
  // --path-as-is http://localhost:4173//` sends exactly that request line, as
  // does anything else that declines to normalize the target for us.
  it("answers a target the URL parser rejects like any other unknown route", async () => {
    const shell = await fetch(origin + "/");
    const unparseable = await fetch(origin + "//");

    expect(unparseable.status).toBe(shell.status);
    expect(await unparseable.text()).toBe(await shell.text());
  });

  it("stays up after a target the URL parser rejects", async () => {
    await fetch(origin + "//@");

    await expect(fetch(origin + "/")).resolves.toBeDefined();
    expect(server.exitCode).toBeNull();
  });

  it("answers a traversal attempt with the shell", async () => {
    const shell = await fetch(origin + "/");
    const traversal = await fetch(origin + "/%2e%2e/package.json");

    expect(traversal.status).toBe(shell.status);
    expect(await traversal.text()).toBe(await shell.text());
  });
});
