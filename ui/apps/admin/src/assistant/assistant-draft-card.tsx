import { Button } from "../components/ui/button";
import type { AssistantDraft } from "@kari/shared/services/assistant";

/**
 * What she is told before she presses the button.
 *
 * The issue goes to a public repository, so she has to know that before
 * she agrees to it — and she has to know the rest is not public, or she
 * has no way to tell what she has just published. The two things named
 * here are the two things the card is already showing her, which is what
 * makes this checkable rather than a promise: what is on the card is what
 * becomes public, and her conversation stays in her own workshop.
 */
export const PUBLIC_ISSUE_NOTE =
  "The title and sentence above are what gets filed, and anyone can read " +
  "them; the rest of our conversation stays private.";

/**
 * The card that asks her permission.
 *
 * Nothing is written down until she presses the button here: the helper's
 * tool can only put this on screen (see `services/assistant.rs`). What she
 * is shown is what she needs to judge it by — the title it would get, and
 * one plain sentence — not the issue body underneath, which is written for
 * whoever picks the work up. It also says what of that becomes public, so
 * that the judgement is an informed one (#888).
 *
 * One primary action per state, per `docs/ui-design-brief.md` §2: filing,
 * or — where this host has nowhere to file — simply letting it go.
 */
export function AssistantDraftCard({
  draft,
  canFile,
  deciding,
  sending,
  error,
  unavailableMessage,
  onFile,
  onDismiss,
}: {
  draft: AssistantDraft;
  canFile: boolean;
  /** True while her decision is in flight. */
  deciding: boolean;
  /**
   * True while a message is in flight — and a reason to wait, not just to
   * look busy. A reply can take most of three minutes, and the card sits
   * there the whole time; deciding mid-reply means the server is answering
   * two questions about one conversation at once. It copes now (the API
   * serialises them), but there is nothing here for her to gain by it: the
   * reply may well rewrite this very card. So the buttons rest until it
   * lands, and the answer she gives is an answer to what she can see.
   */
  sending: boolean;
  /** A plain-language problem to show, if the last attempt failed. */
  error: string | null;
  /** What to say instead of the button when filing is switched off. */
  unavailableMessage: string;
  onFile: () => void;
  onDismiss: () => void;
}) {
  const busy = deciding || sending;
  // A resting button here has to stay a button. The site-wide disabled fill
  // is `bg-muted`, which is this card's OWN fill — so on any other surface
  // it reads as "quiet", and on this one the control would simply disappear
  // into the card and reappear when the reply landed. `bg-card` is the fill
  // the secondary already wears while it is live, so the shape survives at
  // a contrast that is already on screen, and the state still reads: the
  // primary gives up its green, both give up their dark text.
  const resting = "disabled:bg-card";
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

      {/*
        One slot, two things to say: where filing is possible, what will be
        public; where it is not, why there is no button. Never both — a
        note about what gets filed would be a promise about a button that
        is not there.
      */}
      <p className="mt-3 font-sans text-sm leading-relaxed text-muted-foreground">
        {canFile ? PUBLIC_ISSUE_NOTE : unavailableMessage}
      </p>
      {error && (
        <p className="mt-3 font-sans text-sm leading-relaxed text-foreground">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canFile && (
          <Button
            size="sm"
            className={resting}
            disabled={busy}
            onClick={onFile}
          >
            File this issue
          </Button>
        )}
        <Button
          // With nowhere to file, letting it go is the only thing left to
          // do — so it stops being the quiet option and becomes the one.
          variant={canFile ? "secondary" : "primary"}
          size="sm"
          className={resting}
          disabled={busy}
          onClick={onDismiss}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
