import { vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

/**
 * Shared boilerplate for the service test files, which all exercise a
 * service against a stubbed global `fetch` (or `XMLHttpRequest`, for the
 * upload) and an Auth0 token-getter stub.
 */

/**
 * Stubs the global `fetch` to resolve with `response` and returns the mock
 * so tests can assert on the call. `json`/`text` are declared explicitly
 * because `Partial<Response>` alone loses their return types.
 */
export function mockFetchOnce(
  response: Partial<Response> & {
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  },
): Mock {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Stand-in for Auth0's `getAccessTokenSilently`, resolving to "test-token".
 * Re-primed before each test by `setupServiceTestHooks`, so a test that
 * overrides it (e.g. with `mockRejectedValue`) doesn't leak into the next.
 */
export const getToken: Mock<() => Promise<string>> = vi
  .fn<() => Promise<string>>()
  .mockResolvedValue("test-token");

/**
 * Registers the beforeEach/afterEach hooks every service test file needs:
 * silences console output, re-primes `getToken`, and unstubs the `fetch`
 * global. Call once at the top level of the test file.
 */
export function setupServiceTestHooks() {
  beforeEach(() => {
    // keep test output clean; the services log on both success and error paths
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Re-establish each test: the global afterEach runs vi.restoreAllMocks().
    getToken.mockReset();
    getToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

type Listener = (event: ProgressEvent) => void;

/**
 * One `addEventListener` target (the request or its `upload`). Keeps one
 * listener per event type, which is all the code under test registers.
 */
class FakeTarget {
  private readonly listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  /** Fires `type` at the listener registered for it. */
  emit(type: string, init: ProgressEventInit = {}) {
    const listener = this.listeners.get(type) as Listener;
    listener({
      type,
      lengthComputable: false,
      loaded: 0,
      total: 0,
      ...init,
    } as ProgressEvent);
  }
}

export interface StubXhrOptions {
  status: number;
  statusText?: string;
  responseText?: string;
  /**
   * When true (the default) `send()` completes the request on a microtask:
   * one fully-sent progress event, the upload's `load`, then the
   * response's `load`. Pass false to drive the events by hand.
   */
  autoComplete?: boolean;
}

/**
 * Stand-in for `XMLHttpRequest`, recording what the code under test asked
 * of it and answering with the options it was built from. `upload` and the
 * request itself are separate listener targets, as in the browser; a test
 * drives them with `upload.emit(...)` / `emit(...)`.
 */
export class FakeXhr extends FakeTarget {
  readonly upload = new FakeTarget();
  method?: string;
  url?: string;
  readonly headers: Record<string, string> = {};
  body?: unknown;
  status = 0;
  statusText = "";
  responseText = "";

  constructor(private readonly answer: StubXhrOptions) {
    super();
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    const {
      status,
      statusText = "",
      responseText = "",
      autoComplete = true,
    } = this.answer;
    this.body = body;
    this.status = status;
    this.statusText = statusText;
    this.responseText = responseText;
    if (!autoComplete) return;
    queueMicrotask(() => {
      this.upload.emit("progress", {
        lengthComputable: true,
        loaded: 10,
        total: 10,
      });
      this.upload.emit("load");
      this.emit("load");
    });
  }
}

/**
 * Stubs the global `XMLHttpRequest` with a `FakeXhr` answering per
 * `answer`, and returns the list every constructed request is pushed onto
 * so tests can assert on it. Unstubbed by `setupServiceTestHooks`'s
 * `vi.unstubAllGlobals()`.
 */
export function stubXhr(answer: StubXhrOptions): Array<FakeXhr> {
  const requests: Array<FakeXhr> = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    class extends FakeXhr {
      constructor() {
        super(answer);
        requests.push(this);
      }
    },
  );
  return requests;
}
