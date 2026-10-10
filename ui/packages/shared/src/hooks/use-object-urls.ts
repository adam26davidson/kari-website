import { useEffect, useState } from "react";

/**
 * `useObjectUrl` for a list: one `blob:` URL per file, `null` for each
 * `null`, all revoked when the list changes or the component unmounts.
 *
 * Written for the photography preview (#859), where every photograph of a
 * post may be a picked-but-unsaved `File` or a stored image.
 *
 * The effect is keyed on the ARRAY's identity, so the caller must keep
 * `files` referentially stable between renders — memoise it. A `.map` in
 * the render body would hand this a new array every time, and the effect
 * would set state, re-render and run again forever.
 *
 * Before the effect has run the result is `[]`, so index it with
 * `?? null`.
 */
export function useObjectUrls(
  files: ReadonlyArray<Blob | null>,
): Array<string | null> {
  const [urls, setUrls] = useState<Array<string | null>>([]);

  useEffect(() => {
    const created = files.map((file) =>
      file ? URL.createObjectURL(file) : null,
    );
    setUrls(created);
    return () => {
      for (const url of created) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [files]);

  return urls;
}
