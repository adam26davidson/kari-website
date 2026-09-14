import { useEffect, useState } from "react";
import {
  PREVIEW_READY,
  PreviewOverrides,
  isPreviewOverridesMessage,
} from "@kari/shared/utils/preview-channel";
import { PreviewOverridesContext } from "./preview-overrides-context";
import { isPreviewMode } from "./preview-mode";

/**
 * Holds the admin editor's unsaved state for the pages below it, when this
 * document is an admin preview pane (#239).
 *
 * Mounted once, ABOVE the router, which is the whole reason it is a context
 * and not a hook each page calls: the pane is the real SPA, so she can click
 * from the home page to Haiku and back inside it, and the drafts have to
 * survive that. State held per page would be thrown away on the first
 * navigation.
 *
 * Outside preview mode it attaches no listener, posts nothing, and renders
 * its children under the context's `{}` default — one `if` is the whole cost
 * to a visitor.
 *
 * The handshake is iframe-first because the iframe is the side that knows
 * when it is ready: the editor cannot tell when the frame's React has
 * mounted (`load` fires for the document, not for a hydrated app), and a
 * message posted before this listener exists is simply lost. So the frame
 * says READY and the editor answers with its current state.
 */
export function PreviewOverridesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [overrides, setOverrides] = useState<PreviewOverrides>({});

  useEffect(() => {
    if (!isPreviewMode()) return;

    const handleMessage = (event: MessageEvent) => {
      // Same-origin only. The admin and the site share one host by design
      // (#591), so this rejects nothing legitimate — and without it any page
      // that framed this one could inject content into what looks like the
      // real site.
      if (event.origin !== window.location.origin) return;
      if (!isPreviewOverridesMessage(event.data)) return;
      setOverrides(event.data.overrides);
    };

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <PreviewOverridesContext.Provider value={overrides}>
      {children}
    </PreviewOverridesContext.Provider>
  );
}
