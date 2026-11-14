import { useMemo } from "react";
import { useObjectUrls } from "./use-object-urls";

/**
 * A `blob:` URL for a locally picked file, revoked when the file changes or
 * the component unmounts — `null` when there is no file.
 *
 * Extracted from `PhotoPicker` (#239) when the in-editor site preview needed
 * the same thing: the public home page renders a candidate photo that has
 * not been uploaded, so it too has a `File` and needs a URL that dies with
 * it. An object URL that is never revoked pins its blob in memory for the
 * lifetime of the document, which is exactly as long as an admin session.
 *
 * "Changes" means a different file, not a different object: the preview's
 * postMessage structured-clones the draft, so every debounced send hands
 * the framed page a NEW `File` for a photo she has not touched. This is
 * `useObjectUrls` with one entry so that it shares that hook's keying by
 * name, size, type and modification time, and the unchanged photo keeps
 * its URL — and its decoded `<img>` — while she types (#1054).
 */
export function useObjectUrl(file: File | null): string | null {
  // `useObjectUrls` needs a stable array. Memoising on the object is
  // enough: a clone with the same content gets a new array but the same
  // URL back, and the extra render it causes does not change `file`.
  const files = useMemo(() => [file], [file]);
  return useObjectUrls(files)[0] ?? null;
}
