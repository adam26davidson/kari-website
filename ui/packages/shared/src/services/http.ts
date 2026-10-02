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

/** Told the fraction (0-1) of an upload's body sent so far. */
export type UploadProgress = (fraction: number) => void;

/**
 * POSTs `body` with the same bearer header as `authorizedFetch`, reporting
 * how much of it has been sent through `onProgress` — which `fetch` cannot
 * do, hence the `XMLHttpRequest` underneath. The answer comes back as a
 * real `Response`, so callers check and read it exactly as they would a
 * fetched one; like `fetch`, a non-OK status resolves and only a network
 * failure rejects.
 *
 * No Content-Type is set: for a `FormData` body the browser writes the
 * multipart one, boundary included, itself.
 *
 * `onProgress(1)` is guaranteed once the body is fully sent, even when the
 * last progress event stopped short — the server can still be busy after
 * that (the image route resizes before it replies), and callers use the
 * 1 to say so.
 */
export async function authorizedUpload(
  url: string,
  getToken: TokenGetter,
  body: FormData,
  onProgress?: UploadProgress,
): Promise<Response> {
  // Before the request exists, so a failed token lookup never opens one.
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    xhr.upload.addEventListener("load", () => onProgress?.(1));
    xhr.addEventListener("load", () =>
      resolve(
        // `|| null`: a no-content status (204) must not be given a body,
        // not even an empty one, or the Response constructor throws.
        new Response(xhr.responseText || null, {
          status: xhr.status,
          statusText: xhr.statusText,
        }),
      ),
    );
    xhr.addEventListener("error", () =>
      reject(new TypeError("Network request failed")),
    );
    xhr.send(body);
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
