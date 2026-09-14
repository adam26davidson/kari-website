import { createContext, useContext } from "react";

/**
 * What the page she is on is showing, in her words — published by the page
 * and read by the helper panel, which sends it along with each message so
 * the guidance matches her screen.
 *
 * The route is NOT here: the panel reads that from `useLocation()` itself,
 * so every page gets it for free and no page has to remember.
 */
export interface AssistantSubject {
  /** The kind of thing open: "haiku", "photograph", "home page". */
  what?: string;
  id?: string;
  title?: string;
  /** True when there are unsaved changes on screen. */
  dirty?: boolean;
}

export interface AssistantContextValue {
  subject: AssistantSubject;
  /** Publish what is on screen; `null` clears it. */
  publish: (subject: AssistantSubject | null) => void;
}

/**
 * Null when there is no provider above — which is the case in most page
 * tests. Publishing then does nothing rather than throwing, so a page can
 * describe itself to the helper without every one of its tests having to
 * know the helper exists.
 */
export const AssistantContext = createContext<AssistantContextValue | null>(
  null,
);

export function useAssistantContext(): AssistantContextValue | null {
  return useContext(AssistantContext);
}
