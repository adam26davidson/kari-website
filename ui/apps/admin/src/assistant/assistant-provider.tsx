import { useCallback, useMemo, useState } from "react";
import {
  AssistantContext,
  AssistantContextValue,
  AssistantSubject,
} from "./assistant-context";

/**
 * Holds what the current page is showing, so the helper panel — which sits
 * beside the routes rather than inside them — can describe her screen
 * without reaching into the page.
 *
 * Mounted around `<Routes>` in `admin.tsx`, so it survives every
 * client-side navigation along with the conversation itself.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [subject, setSubject] = useState<AssistantSubject>({});

  // `null` clears: a page unmounting says "nothing of mine is on screen"
  // without having to know what replaced it.
  const publish = useCallback(
    (next: AssistantSubject | null) => setSubject(next ?? {}),
    [],
  );

  const value = useMemo<AssistantContextValue>(
    () => ({ subject, publish }),
    [subject, publish],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}
