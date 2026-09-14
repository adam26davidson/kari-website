import { useEffect, useState } from "react";

/**
 * A `blob:` URL for a locally picked file, revoked when the file changes or
 * the component unmounts — `null` when there is no file.
 *
 * Extracted from `PhotoPicker` (#239) when the in-editor site preview needed
 * the same thing: the public home page renders a candidate photo that has
 * not been uploaded, so it too has a `File` and needs a URL that dies with
 * it. An object URL that is never revoked pins its blob in memory for the
 * lifetime of the document, which is exactly as long as an admin session.
 */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
    };
  }, [file]);

  return url;
}
