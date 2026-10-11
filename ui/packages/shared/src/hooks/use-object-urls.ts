import { useEffect, useRef, useState } from "react";

/**
 * `useObjectUrl` for a list: one `blob:` URL per file, `null` for each
 * `null`, each revoked once its file has left the list, and all of them on
 * unmount.
 *
 * Written for the photography preview (#859), where every photograph of a
 * post may be a picked-but-unsaved `File` or a stored image.
 *
 * URLs are keyed by what the file IS, not by row or by object. The preview
 * receives its draft by postMessage, which structured-clones it, so every
 * debounced send delivers NEW `File` objects for the same photos. Keying by
 * name, size, type and modification time lets a photo that has not changed
 * keep its URL — and with it its `<img>`, already decoded — across those
 * sends, instead of blanking and re-decoding on each keystroke. And because
 * the key travels with the file, a reorder moves each URL to its file's new
 * row on the very render the new list arrives: no row is ever answered with
 * another row's photo.
 *
 * A file the hook has not seen before is `null` until the effect has made
 * its URL, so index the result with `?? null`.
 *
 * The effect is keyed on the ARRAY's identity, so the caller must keep
 * `files` referentially stable between renders — memoise it. A `.map` in
 * the render body would hand this a new array every time, and the effect
 * would set state, re-render and run again forever.
 */
export function useObjectUrls(
  files: ReadonlyArray<File | null>,
): Array<string | null> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // The effect's own copy, so it can reuse URLs without depending on state.
  const made = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const next = new Map<string, string>();
    for (const file of files) {
      if (!file) continue;
      const key = fileKey(file);
      if (next.has(key)) continue;
      next.set(key, made.current.get(key) ?? URL.createObjectURL(file));
    }
    for (const [key, url] of made.current) {
      if (!next.has(key)) URL.revokeObjectURL(url);
    }
    made.current = next;
    setUrls(next);
  }, [files]);

  // Unmount. Under StrictMode's simulated unmount/remount the list effect
  // above runs again straight after this and makes fresh URLs.
  useEffect(
    () => () => {
      for (const url of made.current.values()) URL.revokeObjectURL(url);
      made.current = new Map();
    },
    [],
  );

  return files.map((file) => (file ? (urls.get(fileKey(file)) ?? null) : null));
}

/**
 * What survives a structured clone. Two picks agreeing on all four are, in
 * practice, the same file from disk — and would show the same photo anyway.
 */
function fileKey(file: File): string {
  return [file.name, file.size, file.type, file.lastModified].join("\u0000");
}
