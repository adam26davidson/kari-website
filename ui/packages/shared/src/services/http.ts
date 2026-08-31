import { HttpError } from "./http-error";

/**
 * Shape of Auth0's `getAccessTokenSilently`. Services accept one of these
 * instead of importing the Auth0 SDK, so components pass the hook's
 * function through and tests pass a stub.
 */
export type TokenGetter = () => Promise<string>;

/**
 * `fetch` init narrowed to plain-object headers so the bearer header can
 * be merged in predictably (the `Headers` / tuple-array forms are never
 * used by these services).
 */
export type AuthorizedFetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

/**
 * `fetch` with an `Authorization: Bearer <token>` header obtained from
 * `getToken`. Headers in `init` are kept; the bearer header is added on
 * top and wins on conflict.
 */
export async function authorizedFetch(
  url: string,
  getToken: TokenGetter,
  init?: AuthorizedFetchInit,
): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Throws an `HttpError` when `response` is not OK, logging the failure
 * first. `what` names the failed operation for the thrown message (e.g.
 * "Failed to fetch haiku list" becomes "Failed to fetch haiku list
 * (HTTP 500)"); `logAs` optionally gives the console line more context —
 * typically which backend (API vs S3) actually failed — and defaults to
 * `what`. No-op for an OK response.
 */
export function ensureOk(
  response: Response,
  what: string,
  logAs: string = what,
): void {
  if (!response.ok) {
    console.error(logAs, response.status);
    throw new HttpError(`${what} (HTTP ${response.status})`, response.status);
  }
}

/**
 * Best-effort read of a failed response's body, for callers that include
 * the server's reason in their error message. An unreadable body yields
 * "" so the caller can still fail on the status alone.
 */
export async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
