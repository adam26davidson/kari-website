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
  // The URLs remember which list they were made for. On the render where a
  // new list arrives, the effect has not run yet and the old URLs are about
  // to be revoked — and line up with the OLD rows, so a reorder would put a
  // photo in the wrong place for a frame. Until the effect catches up the
  // answer is "none yet".
  const [made, setMade] = useState<{
    files: ReadonlyArray<Blob | null>;
    urls: Array<string | null>;
  } | null>(null);

  useEffect(() => {
    const urls = files.map((file) => (file ? URL.createObjectURL(file) : null));
    setMade({ files, urls });
    return () => {
      for (const url of urls) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [files]);

  return made?.files === files ? made.urls : [];
}
