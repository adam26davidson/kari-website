import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { MessageCircle, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { useAdminToken } from "../hooks/use-admin-token";
import { useAssistantContext } from "./assistant-context";
import {
  RESTING_MESSAGE,
  useAssistantSession,
  type StorageLike,
} from "./use-assistant-session";

/** Opens the panel on load, so the screenshot capture can photograph it. */
const OPEN_PARAM = "assistant";

const GREETING =
  "Hi Kari — ask how to do something, or tell me about a problem or an idea for the site.";

/**
 * The helper: a small round button in the corner of every admin screen, and
 * the conversation panel it opens.
 *
 * It sits beside the routes rather than inside them (see `admin.tsx`), so
 * the conversation follows her from page to page; the id is kept in local
 * storage, so it also survives a reload. That is what lets the helper walk
 * her through something that spans several pages.
 *
 * Everything here is Tailwind on the shell's own tokens — no new stylesheet
 * and no new dependency. The transcript's scrollbar is a utility rather
 * than a CSS rule on purpose: `test/design/scroll-containers.test.ts` pins
 * the set of scrolling boxes declared in stylesheets, and this panel is a
 * fixed element outside `.admin-content` rather than a second page scroller.
 */
export function AssistantWidget({
  storage,
}: {
  /** Test seam; production uses the real local storage. */
  storage?: StorageLike | null;
}) {
  const location = useLocation();
  const getToken = useAdminToken();
  const pageContext = useAssistantContext();
  const { phase, messages, sending, error, begin, send, startOver } =
    useAssistantSession(getToken, storage);

  const [open, setOpen] = useState(
    () => new URLSearchParams(location.search).get(OPEN_PARAM) === "open",
  );
  const [draft, setDraft] = useState("");
  const transcriptEnd = useRef<HTMLDivElement>(null);

  // Nothing is asked of the API until she opens the panel, so an admin page
  // she never asks for help on costs no requests at all.
  useEffect(() => {
    if (open) begin();
  }, [open, begin]);

  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  const submit = async () => {
    const text = draft;
    // Cleared optimistically so the box is empty while she waits; put back
    // verbatim on failure, because losing what she wrote is the one thing a
    // failed send must never do.
    setDraft("");
    const sent = await send(text, {
      route: location.pathname,
      ...pageContext?.subject,
    });
    if (!sent) setDraft(text);
  };

  // The corner button is the way IN; the panel's own header is the way out.
  // Only one of them is on screen at a time, so there are never two controls
  // with the same name — and at phone width, where the panel fills the
  // screen, a floating button on top of it would have nothing to sit on.
  if (!open) {
    return (
      <Button
        size="icon"
        // `.admin-assistant-toggle` is the e2e hook.
        className="admin-assistant-toggle fixed bottom-6 right-6 z-[1000] size-14 shadow-[0_10px_28px_rgba(74,62,40,0.22)]"
        aria-label="Ask the helper"
        onClick={() => setOpen(true)}
      >
        <MessageCircle />
      </Button>
    );
  }

  return (
    <div
      // Floating card on desktop and tablet; at phone width it fills the
      // screen rather than perching in a corner, so the conversation is
      // comfortable to read and type into.
      className={
        "admin-assistant fixed bottom-6 right-6 z-[1000] flex w-[380px] " +
        "max-h-[min(560px,calc(100vh-80px))] flex-col overflow-hidden " +
        "rounded-xl border border-border bg-card " +
        "shadow-[0_18px_48px_rgba(74,62,40,0.22)] " +
        "max-sm:inset-0 max-sm:max-h-none max-sm:w-auto max-sm:rounded-none"
      }
      role="dialog"
      aria-label="The helper"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="font-serif text-lg italic text-foreground">Helper</h2>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                startOver();
                setDraft("");
              }}
            >
              Start again
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            aria-label="Close the helper"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {phase === "checking" && (
          <p className="font-sans text-sm text-muted-foreground">
            Just a moment — waking the helper up.
          </p>
        )}

        {phase === "resting" && (
          <p className="font-sans text-sm leading-relaxed text-muted-foreground">
            {RESTING_MESSAGE}
          </p>
        )}

        {phase === "ready" && messages.length === 0 && (
          // Her name, in the site's own serif — the panel greets rather
          // than presents a blank box.
          <p className="font-serif text-base italic leading-relaxed text-foreground">
            {GREETING}
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "mb-3 ml-8 rounded-xl bg-muted px-4 py-2.5 font-sans text-sm leading-relaxed text-foreground"
                : "mb-3 mr-8 rounded-xl border border-border px-4 py-2.5 font-sans text-sm leading-relaxed text-foreground"
            }
          >
            {/* Her words and the helper's both arrive as plain text and
                  are rendered as plain text — nothing here interprets
                  markup. Blank lines are kept so a step-by-step answer
                  still reads as steps. */}
            {message.text.split("\n").map((line, lineIndex) => (
              <p key={lineIndex} className={line ? "" : "h-3"}>
                {line}
              </p>
            ))}
          </div>
        ))}

        {sending && (
          <p className="mr-8 font-sans text-sm italic text-muted-foreground">
            Thinking…
          </p>
        )}

        {error && (
          <p className="mt-2 font-sans text-sm leading-relaxed text-foreground">
            {error}
          </p>
        )}

        <div ref={transcriptEnd} />
      </div>

      {phase === "ready" && (
        <div className="border-t border-border px-5 py-4">
          <Textarea
            className="min-h-[44px] max-h-32"
            value={draft}
            placeholder="Ask me anything about your site"
            aria-label="Your message"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter starts a new line — what a chat
              // box is expected to do.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="mt-3 flex justify-end">
            <Button
              disabled={sending || draft.trim().length === 0}
              onClick={() => void submit()}
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
