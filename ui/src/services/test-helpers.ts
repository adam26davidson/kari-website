import { vi, beforeEach, afterEach } from "vitest";

/**
 * Shared boilerplate for the service test files, which all exercise a
 * service against a stubbed global `fetch` and an Auth0 token-getter stub.
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
) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Stand-in for Auth0's `getAccessTokenSilently`, resolving to "test-token".
 * Re-primed before each test by `setupServiceTestHooks`, so a test that
 * overrides it (e.g. with `mockRejectedValue`) doesn't leak into the next.
 */
export const getToken = vi.fn().mockResolvedValue("test-token");

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
