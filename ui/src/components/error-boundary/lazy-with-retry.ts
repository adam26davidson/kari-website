import { ComponentType, lazy, LazyExoticComponent } from "react";

/**
 * Message fragments browsers emit when a dynamic `import()` of a route
 * chunk fails: Chrome/Edge ("Failed to fetch dynamically imported
 * module"), Firefox ("error loading dynamically imported module"),
 * Safari ("Importing a module script failed"), plus the webpack-style
 * "Loading chunk N failed" for completeness.
 */
const CHUNK_LOAD_MESSAGE =
  /dynamically imported module|Importing a module script failed|Loading chunk/i;

/**
 * True when `error` looks like a failed lazy-chunk fetch — the typical
 * symptom of a redeploy replacing hashed chunk filenames out from under
 * an open tab.
 */
export function isChunkLoadError(error: unknown): error is Error {
  return error instanceof Error && CHUNK_LOAD_MESSAGE.test(error.message);
}

/**
 * sessionStorage key marking that this tab already auto-reloaded once
 * to recover from a failed chunk load. Its presence stops a second
 * automatic reload, so a persistent failure (offline, bad deploy)
 * falls through to the ErrorBoundary instead of reload-looping.
 */
export const CHUNK_RELOAD_FLAG = "chunk-load-reloaded";

/** Minimal Storage surface so tests can substitute an in-memory fake. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Test seams; production callers omit these and get the real thing. */
interface LazyRetryHooks {
  /** Defaults to a full page reload. */
  reload?: () => void;
  /** Defaults to window.sessionStorage. */
  storage?: StorageLike | null;
}

function defaultStorage(): StorageLike | null {
  // Accessing sessionStorage can itself throw (e.g. cookies disabled).
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// When storage is unusable we report the flag as already set: we can't
// remember having reloaded, so never auto-reload (avoids a loop) and
// let the ErrorBoundary present its reload prompt instead.
function hasReloadedFlag(storage: StorageLike | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(CHUNK_RELOAD_FLAG) !== null;
  } catch {
    return true;
  }
}

function setReloadedFlag(storage: StorageLike | null): void {
  try {
    storage?.setItem(CHUNK_RELOAD_FLAG, "1");
  } catch {
    // Ignore: worst case the boundary shows its manual reload prompt.
  }
}

function clearReloadedFlag(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    // Ignore: a stale flag only suppresses a future auto-reload.
  }
}

/**
 * `React.lazy` with recovery for failed chunk loads (issue #107).
 *
 * Browsers/Vite can cache a *rejected* dynamic-`import()` promise per
 * URL, so simply re-rendering a failed lazy route may re-throw without
 * ever hitting the network again. A cache-busting query string is not
 * an option here — these are statically analyzed imports and rewriting
 * the URL would bypass Vite's chunk graph. Instead:
 *
 * 1. On failure, call the import factory once more. Browsers that
 *    don't cache the rejection (and transient network blips) recover
 *    right here.
 * 2. If the retry also fails with a chunk-load error, reload the page
 *    once — after a redeploy the old hashed chunk URLs are gone and
 *    only fresh HTML can reference the new ones. A sessionStorage flag
 *    (cleared on any successful load) guarantees at most one automatic
 *    reload, so a persistent failure falls through to the
 *    ErrorBoundary, which shows tailored "new version deployed" copy.
 */
export function lazyWithRetry<T extends ComponentType>(
  factory: () => Promise<{ default: T }>,
  hooks: LazyRetryHooks = {},
): LazyExoticComponent<T> {
  const reload = hooks.reload ?? (() => window.location.reload());
  const getStorage = () =>
    hooks.storage !== undefined ? hooks.storage : defaultStorage();

  return lazy(async () => {
    try {
      const loaded = await factory();
      clearReloadedFlag(getStorage());
      return loaded;
    } catch {
      try {
        const loaded = await factory();
        clearReloadedFlag(getStorage());
        return loaded;
      } catch (retryError) {
        const store = getStorage();
        if (isChunkLoadError(retryError) && !hasReloadedFlag(store)) {
          setReloadedFlag(store);
          reload();
          // Never settle: keep Suspense on its fallback while the
          // reload tears this document down.
          return new Promise<never>(() => {});
        }
        throw retryError;
      }
    }
  });
}
