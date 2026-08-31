import { useCallback, useEffect, useState } from "react";

/**
 * Load-on-mount scaffolding shared by the public pages: fetches once via
 * `fetcher`, tracks the `isLoading` / `loadFailed` pair, and returns
 * `load` so a failure can offer a Retry action. A failed fetch flips
 * `loadFailed` and leaves `data` at its initial value — callers render a
 * LoadError instead of the data, so an S3 outage is never mistaken for
 * legitimately empty content (the services throw rather than return empty
 * data for the same reason).
 *
 * `fetcher` must be referentially stable (e.g. a static service method):
 * it is a dependency of `load`, so a new function on every render would
 * refetch in a loop.
 */
export function useS3Load<T>(fetcher: () => Promise<T>, initialData: T) {
  const [data, setData] = useState<T>(initialData);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setData(await fetcher());
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, isLoading, loadFailed, load };
}
