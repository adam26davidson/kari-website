import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
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
const DIST = path.join(UI_ROOT, "dist");

// chmod 000 is how the unopenable-file case is staged, and it is not a real
// restriction for root or on Windows — the stream would open and the test
// would assert 500 against a healthy 200.
const CAN_MAKE_UNREADABLE =
  process.platform !== "win32" && process.getuid?.() !== 0;

/**
 * A port nothing is listening on, so parallel runs don't collide.
 *
 * The probe binds every interface rather than one address, so the port it
 * reports is free on all of them — the binding test below needs one that is
 * free on 127.0.0.1 and ::1 alike.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Whether `host` can be bound here at all. @param host */
function canBind(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.on("error", () => resolve(false));
    probe.listen(0, host, () => probe.close(() => resolve(true)));
  });
}

/** Resolves if a TCP connection to `host:port` is accepted, rejects if not. */
function connect(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

/** Start scripts/serve.mjs and wait until it answers on `origin`. */
async function startServer(
  args: string[],
  origin: string,
): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVE, ...args], {
    cwd: UI_ROOT,
    stdio: "ignore",
  });
  // Poll rather than wait on stdout: the ready line is printed by listen()'s
  // callback, but the socket is what the tests actually need.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(origin + "/");
      return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill();
  throw new Error(`preview server never started on ${origin}`);
}

// The binding test needs a second loopback address to prove the first one is
// the only one bound; a machine without IPv6 loopback has no way to show it.
const HAS_IPV6_LOOPBACK = await canBind("::1");

let server: ChildProcess;
let origin: string;

beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  server = await startServer(["--port", String(port)], origin);
}, 20_000);

afterAll(() => {
  server?.kill();
});

describe("the preview server", () => {
  // `--host` has to constrain the socket, not just the ready line: this
  // stands in for `vite preview`, which binds loopback unless told
  // otherwise, so a preview of an unreleased site must not be reachable
  // from the rest of the network. From outside the process the way to see
  // which addresses are bound is to bind ONE loopback address and watch the
  // other refuse: `listen(port)` with no host binds every interface, so both
  // would answer.
  it.skipIf(!HAS_IPV6_LOOPBACK)(
    "binds only the host it was given",
    async () => {
      const port = await freePort();
      const child = await startServer(
        ["--port", String(port), "--host", "127.0.0.1"],
        `http://127.0.0.1:${port}`,
      );

      try {
        await expect(connect(port, "::1")).rejects.toMatchObject({
          code: "ECONNREFUSED",
        });
      } finally {
        child.kill();
      }
    },
    20_000,
  );

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

  // The stat/open race this stands in for: `npm run build` empties dist/ via
  // emptyOutDir while a request is in flight, so a file that passed the stat
  // check is gone by the time the read stream opens. That race is not
  // reproducible on demand, but it is the same code path as any other
  // open-time failure — an 'error' event on a stream nothing is listening to
  // — and chmod 000 produces one deterministically: stat still succeeds,
  // open fails EACCES.
  it.skipIf(!CAN_MAKE_UNREADABLE)(
    "stays up when a file that passed the stat check cannot be opened",
    async () => {
      // dist/ need not exist here (the suite runs without a build in CI), and
      // a directory this test created is not one it should leave behind.
      const distExisted = fs.existsSync(DIST);
      fs.mkdirSync(DIST, { recursive: true });
      // Unique per process so parallel runs in one worktree cannot collide.
      const name = `unreadable-${process.pid}.txt`;
      const file = path.join(DIST, name);
      try {
        fs.writeFileSync(file, "unopenable");
        fs.chmodSync(file, 0o000);

        const unopenable = await fetch(`${origin}/${name}`);
        expect(unopenable.status).toBe(500);
        await unopenable.text();

        await expect(fetch(origin + "/")).resolves.toBeDefined();
        expect(server.exitCode).toBeNull();
      } finally {
        fs.rmSync(file, { force: true });
        if (!distExisted) fs.rmSync(DIST, { force: true, recursive: true });
      }
    },
  );
});
