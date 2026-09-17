import { Button } from "../components/ui/button";
import type { AssistantDraft } from "@kari/shared/services/assistant";

/**
 * The card that asks her permission.
 *
 * Nothing is written down until she presses the button here: the helper's
 * tool can only put this on screen (see `services/assistant.rs`). What she
 * is shown is what she needs to judge it by — the title it would get, and
 * one plain sentence — not the issue body underneath, which is written for
 * whoever picks the work up.
 *
 * One primary action per state, per `docs/ui-design-brief.md` §2: filing,
 * or — where this host has nowhere to file — simply letting it go.
 */
export function AssistantDraftCard({
  draft,
  canFile,
  deciding,
  error,
  unavailableMessage,
  onFile,
  onDismiss,
}: {
  draft: AssistantDraft;
  canFile: boolean;
  /** True while her decision is in flight. */
  deciding: boolean;
  /** A plain-language problem to show, if the last attempt failed. */
  error: string | null;
  /** What to say instead of the button when filing is switched off. */
  unavailableMessage: string;
  onFile: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      // `.admin-assistant-draft` is the e2e hook.
      className={
        "admin-assistant-draft mb-3 mr-8 rounded-xl border border-border " +
        "bg-muted px-4 py-3"
      }
    >
      <p className="font-sans text-sm text-muted-foreground">
        {draft.kind === "bug"
          ? "Shall I write this down as something to fix?"
          : "Shall I write this down as an idea for the site?"}
      </p>
      <p className="mt-2 font-serif text-base italic leading-snug text-foreground">
        {draft.title}
      </p>
      <p className="mt-1 font-sans text-sm leading-relaxed text-foreground">
        {draft.summary}
      </p>

      {!canFile && (
        <p className="mt-3 font-sans text-sm leading-relaxed text-foreground">
          {unavailableMessage}
        </p>
      )}
      {error && (
        <p className="mt-3 font-sans text-sm leading-relaxed text-foreground">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canFile && (
          <Button size="sm" disabled={deciding} onClick={onFile}>
            File this issue
          </Button>
        )}
        <Button
          // With nowhere to file, letting it go is the only thing left to
          // do — so it stops being the quiet option and becomes the one.
          variant={canFile ? "secondary" : "primary"}
          size="sm"
          disabled={deciding}
          onClick={onDismiss}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
