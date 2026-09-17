import { useEffect } from "react";
import { AssistantSubject, useAssistantContext } from "./assistant-context";

/**
 * Tell the helper what this page is showing, for as long as it is mounted.
 *
 * A page calls this with the item it has open and whether it has unsaved
 * changes; the helper sends that along with her next message so its
 * guidance matches what is actually on her screen.
 *
 * Safe without a provider (most page tests): publishing is simply skipped.
 *
 * Lives in its own module rather than beside the provider because
 * `react-refresh/only-export-components` is an error at `--max-warnings 0`,
 * and a `.tsx` file may not export both a component and a hook.
 */
export function useAssistantSubject(subject: AssistantSubject): void {
  const context = useAssistantContext();
  const publish = context?.publish;
  // Compared by value: callers build this object inline, so a reference
  // check would republish on every render and loop through the provider's
  // state update.
  const serialized = JSON.stringify(subject);

  useEffect(() => {
    if (!publish) return;
    publish(JSON.parse(serialized) as AssistantSubject);
    return () => publish(null);
  }, [publish, serialized]);
}
