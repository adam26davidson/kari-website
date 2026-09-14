import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantContext,
  AssistantMessage,
  AssistantService,
} from "@kari/shared/services/assistant";
import { HttpError } from "@kari/shared/services/http-error";
import { TokenGetter } from "@kari/shared/services/http";

/** Where the conversation id is remembered across reloads. */
export const SESSION_STORAGE_KEY = "kari-admin-assistant-session";

/** The slice of `Storage` this hook uses, so tests can substitute a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `window.localStorage`, or null when it cannot be used.
 *
 * Reaching for the global can itself throw (cookies disabled, a hardened
 * browser profile), so the access is guarded, not just the reads — the same
 * shape as `lazy-with-retry.ts`'s sessionStorage seam. Without storage the
 * conversation simply does not survive a reload; nothing else changes.
 */
export function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readId(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(SESSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeId(storage: StorageLike | null, id: string): void {
  try {
    storage?.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // Ignore: the conversation still works, it just will not be found again
    // after a reload.
  }
}

function clearId(storage: StorageLike | null): void {
  try {
    storage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore: a stale id is dropped on the next failed restore anyway.
  }
}

/**
 * What the panel is doing.
 *
 * - `idle` — not opened yet; nothing has been asked of the API.
 * - `checking` — finding out whether the helper is configured.
 * - `resting` — it is not, or the check could not be made at all.
 * - `ready` — it can be talked to.
 *
 * Only the availability check sets `resting`, and it runs before she has
 * typed anything. Once the panel is `ready` it stays that way: a message
 * that fails is reported under the transcript, with her words still in the
 * box, rather than by folding the conversation away.
 */
export type AssistantPhase = "idle" | "checking" | "resting" | "ready";

export interface AssistantSessionState {
  phase: AssistantPhase;
  messages: AssistantMessage[];
  /** True while a message is in flight — the panel shows "thinking". */
  sending: boolean;
  /** A plain-language problem to show under the transcript, if any. */
  error: string | null;
  /** Start talking to the API. Called when the panel first opens. */
  begin: () => void;
  /** Send one message. Resolves false when it failed and she should retry. */
  send: (text: string, context: AssistantContext) => Promise<boolean>;
  /** Forget this conversation and start an empty one. */
  startOver: () => void;
}

/** Shown when the helper is off, capped, or unreachable. */
export const RESTING_MESSAGE =
  "The helper is resting right now. Everything else works as usual — try again later.";

/**
 * Shown when a send fails, including when the helper's upstream is briefly
 * unreachable. Her words are still in the box; say so, and say that trying
 * again is worth doing — because unlike the resting state, it is.
 */
export const SEND_FAILED_MESSAGE =
  "Couldn't reach the helper — your message is still here; try again in a moment.";

/**
 * Shown when a ceiling is reached.
 *
 * Word for word the API's own `ENOUGH_FOR_NOW_MESSAGE`, and both halves
 * matter: the API sends the same 429 for a conversation that has run its
 * length AND for the day's total across all conversations, so a message that
 * only offered "start a new one" would be plainly false on the daily cap —
 * she would start a new conversation, send, and be told the very same thing.
 */
export const ENOUGH_FOR_NOW_MESSAGE =
  "The helper has talked enough for now. Start a new conversation, or try again later.";

/**
 * Owns the conversation: whether the helper is available, the transcript,
 * and the id that lets a reload pick the same conversation back up.
 *
 * Nothing is asked of the API until `begin()` — opening an admin page costs
 * no requests, and the panel is only consulted when she opens it.
 *
 * The session is created lazily, on her FIRST message rather than on open,
 * so merely looking at the panel never leaves an empty conversation behind
 * in storage.
 */
export function useAssistantSession(
  getToken: TokenGetter,
  storageOverride?: StorageLike | null,
): AssistantSessionState {
  const storage = useMemo(
    () => (storageOverride !== undefined ? storageOverride : defaultStorage()),
    [storageOverride],
  );

  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The id is a ref, not state: nothing renders from it, and a send that
  // has just created a session must see it immediately rather than on the
  // next render.
  const sessionId = useRef<string | null>(null);
  const [started, setStarted] = useState(false);
  /**
   * Whether the availability check is already running.
   *
   * A ref rather than the phase, and reset on cleanup, because both
   * alternatives are broken: reading `phase` would put it in this effect's
   * dependencies, so setting it to "checking" would re-run the effect and
   * the cleanup would cancel the very request it just started; and a ref
   * that is never reset would leave StrictMode's deliberate
   * mount/unmount/remount stuck in "checking", since the second mount would
   * skip the check the first mount's cleanup cancelled.
   */
  const checking = useRef(false);

  const begin = useCallback(() => setStarted(true), []);

  useEffect(() => {
    if (!started || checking.current) return;
    checking.current = true;
    let cancelled = false;
    setPhase("checking");

    const check = async () => {
      try {
        const status = await AssistantService.getStatus(getToken);
        if (cancelled) return;
        if (!status.available) {
          setPhase("resting");
          return;
        }
        // Restore the conversation from before the reload, if there is one.
        const stored = readId(storage);
        if (stored) {
          try {
            const session = await AssistantService.getSession(stored, getToken);
            if (cancelled) return;
            sessionId.current = session.id;
            setMessages(session.messages);
          } catch (restoreError) {
            // A conversation the server no longer has is not a failure —
            // she simply gets a fresh one, which is what the empty panel
            // already invites her to start.
            if (
              restoreError instanceof HttpError &&
              restoreError.status === 404
            ) {
              clearId(storage);
            } else {
              throw restoreError;
            }
          }
        }
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("resting");
      }
    };

    void check();
    return () => {
      cancelled = true;
      checking.current = false;
    };
  }, [started, getToken, storage]);

  const send = useCallback(
    async (text: string, context: AssistantContext): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || sending) return false;
      setSending(true);
      setError(null);
      // Show her message straight away; the server's copy replaces the
      // whole transcript when the reply lands.
      setMessages((current) => [...current, { role: "user", text: trimmed }]);

      try {
        if (!sessionId.current) {
          const session = await AssistantService.createSession(getToken);
          sessionId.current = session.id;
          writeId(storage, session.id);
        }
        const session = await AssistantService.sendMessage(
          sessionId.current,
          trimmed,
          context,
          getToken,
        );
        setMessages(session.messages);
        return true;
      } catch (sendError) {
        // Drop the optimistic line: the widget puts her words back in the
        // box, so leaving it would show the message twice.
        setMessages((current) => current.slice(0, -1));
        const status =
          sendError instanceof HttpError ? sendError.status : undefined;
        // The PHASE is never changed here, only the message under the
        // transcript. A failed send — including the 503 one upstream blip
        // produces — has to leave the conversation usable: moving to
        // "resting" would take the box away with her words still in it and
        // offer her no way to do the one thing the message tells her to do,
        // short of reloading the page. "Resting" belongs to the availability
        // check alone, which runs before she has typed anything.
        setError(status === 429 ? ENOUGH_FOR_NOW_MESSAGE : SEND_FAILED_MESSAGE);
        return false;
      } finally {
        setSending(false);
      }
    },
    [getToken, sending, storage],
  );

  const startOver = useCallback(() => {
    sessionId.current = null;
    clearId(storage);
    setMessages([]);
    setError(null);
  }, [storage]);

  return { phase, messages, sending, error, begin, send, startOver };
}
