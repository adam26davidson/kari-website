import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CircleAlert, Monitor, Smartphone } from "lucide-react";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import {
  PREVIEW_OVERRIDES,
  PREVIEW_QUERY_PARAM,
  PreviewOverrides,
  isPreviewReadyMessage,
} from "@kari/shared/utils/preview-channel";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

/**
 * The two widths she is shown, and the words she is shown them under.
 *
 * "Computer" and "Phone", not "desktop"/"mobile"/"390px" — the design
 * brief's plain vocabulary (§3). The pixel sizes are ordinary window sizes,
 * and 390 is deliberately the width the public site's own phone layout and
 * the visual check both use.
 */
const DEVICES = {
  computer: { label: "Computer", icon: Monitor, width: 1280, height: 800 },
  phone: { label: "Phone", icon: Smartphone, width: 390, height: 760 },
} as const;

type DeviceName = keyof typeof DEVICES;

const DEVICE_NAMES = Object.keys(DEVICES) as DeviceName[];

/**
 * How long after the last keystroke the pane is re-sent. Long enough that
 * typing a sentence is a handful of messages rather than one per character,
 * short enough to read as live.
 */
const RESEND_DELAY_MS = 300;

/**
 * How long a frame that has finished loading gets to say it is ready before
 * the pane gives up on it (#865).
 *
 * Armed by the iframe's `load` event, never by mount. An iframe raises no
 * error for an HTTP failure: an empty 502, a server error page or a deploy
 * caught half-way all fire `load` and then never say READY. A slow but
 * healthy site has simply not fired `load` yet, so it is never timed out —
 * a false "the site may be offline" would cost more of her trust than a
 * few seconds of blank pane. Once `load` has fired, READY is only React
 * mounting (tens of milliseconds), so five seconds is a wide margin; don't
 * tune it below about three.
 */
export const READY_TIMEOUT_MS = 5000;

/**
 * `loading` until the frame says READY; `failed` when it loaded and never
 * did. READY always wins, whichever order it and `load` arrive in.
 */
type FrameStatus = "loading" | "ready" | "failed";

/** The iframe's accessible name, which the e2e journey reaches it by. */
export const PREVIEW_FRAME_TITLE = "Preview of your site";

/**
 * A live view of a public page as her unsaved edits would leave it (#239),
 * for embedding at the foot of an editor.
 *
 * It is a real iframe of the real site, not a re-implementation of it: the
 * admin and the public build are served from one origin (#591), so the pane
 * can show the actual page, with the actual stylesheets, and stay right for
 * free as the site changes. Because the framed app is an SPA, the pane is
 * also navigable — she can click through to Haiku and back inside it, and
 * her drafts survive that (the overrides live in a context above the framed
 * router).
 *
 * The width toggle SCALES rather than just resizing. The pane is only about
 * 650px wide inside the editor column, and the public site's phone layout
 * starts below 768px, so an unscaled "computer" iframe would show her the
 * phone layout and call it a computer. Instead the frame is given the real
 * device width and shrunk to fit with a CSS transform, which is the same
 * trick a browser's device toolbar plays.
 *
 * Measured with a ref and a window `resize` listener rather than a
 * ResizeObserver: jsdom implements no ResizeObserver and `test/setup.ts`
 * does not polyfill one, and the only thing that changes this container's
 * width is the window.
 *
 * Toggling restyles the ONE mounted iframe — it never remounts it. A
 * remount would drop the overrides already delivered and restart the
 * handshake, so switching to Phone would blank her draft.
 *
 * "Try again" (after a frame that never became ready) and a change of
 * `path` DO remount it, on purpose, through its `key`: re-assigning the
 * same `src` is invisible to React, and a fresh element is the one
 * dependable way to reload a frame. Both start a fresh handshake.
 */
export function SitePreview({
  path,
  description,
  overrides,
}: {
  /** Public route to frame, e.g. `"/"`. */
  path: string;
  /** One plain line saying what she is looking at and that it is not saved. */
  description: string;
  /**
   * The editor's current, unsaved form state. Memoise it in the caller: a
   * fresh object each render would restart the debounce on every keystroke
   * of every OTHER field too.
   */
  overrides: PreviewOverrides;
}) {
  // On a phone the pane is barely 320px wide, so a 1280px frame scaled into
  // it is a thumbnail nobody can read (verified by capture: at that width
  // the site's own nav is a few pixels tall). Start her on the width she is
  // actually holding; the toggle still offers the other one.
  const onAPhone = useIsMobile();
  const [device, setDevice] = useState<DeviceName>(
    onAPhone ? "phone" : "computer",
  );
  const [scale, setScale] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The latest overrides, readable from the message listener without making
  // the listener depend on them (which would re-attach it per keystroke).
  const overridesRef = useRef(overrides);
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const readyTimerRef = useRef<number | undefined>(undefined);
  const frameKey = `${path}#${attempt}`;

  const { width, height } = DEVICES[device];

  const postOverrides = useCallback((value: PreviewOverrides) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_OVERRIDES, overrides: value },
      // Same-origin by construction; stated rather than "*" so a future
      // cross-origin preview host cannot silently start receiving drafts.
      window.location.origin,
    );
  }, []);

  // The frame announces itself when its React has mounted and is listening;
  // answer with whatever the form holds at that moment. Anything posted
  // before that is simply lost, which is why the frame speaks first.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      // Only our own frame. Any other framed document on this origin could
      // otherwise trigger a send.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewReadyMessage(event.data)) return;
      postOverrides(overridesRef.current);
      window.clearTimeout(readyTimerRef.current);
      setStatus("ready");
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [postOverrides]);

  // Each new frame (first mount, Try again, a new path) starts unproven,
  // and an unmounted one must not fire its guard. Idempotent, so
  // StrictMode's double run is harmless.
  useEffect(() => {
    setStatus("loading");
    return () => window.clearTimeout(readyTimerRef.current);
  }, [frameKey]);

  // The document arrived; now it has READY_TIMEOUT_MS to speak. A later
  // `load` (she followed a link inside the pane) re-arms rather than
  // stacks, and can never undo a pane that already said READY.
  const handleFrameLoad = () => {
    window.clearTimeout(readyTimerRef.current);
    readyTimerRef.current = window.setTimeout(
      () => setStatus((s) => (s === "loading" ? "failed" : s)),
      READY_TIMEOUT_MS,
    );
  };

  // Re-send on every form change, debounced, so the pane follows her typing.
  useEffect(() => {
    overridesRef.current = overrides;
    const timer = setTimeout(() => postOverrides(overrides), RESEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [overrides, postOverrides]);

  useEffect(() => {
    const measure = () => {
      // clientWidth is 0 until the browser has laid the card out — and
      // always, in jsdom, which does no layout at all. `|| width` reads that
      // as "no reason to shrink yet" rather than scaling the frame to
      // nothing.
      const available = stageRef.current?.clientWidth || width;
      setScale(Math.min(1, available / width));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [width]);

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground font-serif text-lg italic">
          See it on your site
        </h3>
        <p className="text-muted-foreground font-sans text-sm">{description}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Secondary controls only: Save stays the one primary action on an
            editor (design brief §2). */}
        <div className="flex gap-2" role="group" aria-label="Preview width">
          {DEVICE_NAMES.map((name) => {
            const { label, icon: Icon } = DEVICES[name];
            const selected = name === device;
            return (
              <Button
                key={name}
                variant="secondary"
                size="sm"
                aria-pressed={selected}
                onClick={() => setDevice(name)}
                // The chosen one is named in dark green inside a green
                // hairline — the palette's "green leads" — rather than
                // filled, which would make a width switch look like the
                // screen's main action.
                className={cn(
                  selected && "border-primary text-primary font-medium",
                )}
              >
                <Icon strokeWidth={1.75} />
                {label}
              </Button>
            );
          })}
        </div>
        {/* Maroon, like every other way out of the workshop (the sidebar's
            "See your site"). This one leaves for the LIVE page, with no
            preview parameter and so none of her unsaved edits. */}
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="text-accent flex items-center gap-2 font-sans text-sm font-medium hover:underline"
        >
          <ArrowUpRight className="size-4 shrink-0" strokeWidth={1.75} />
          Open in a new tab
        </a>
      </div>
      <div
        ref={stageRef}
        className="border-border bg-background flex justify-center overflow-hidden rounded-lg border"
      >
        {status === "failed" ? (
          <FrameFailedNotice onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          // Sized to the SCALED frame, so the shrunk page takes exactly the
          // room it looks like it takes.
          <div
            className="overflow-hidden"
            style={{ width: width * scale, height: height * scale }}
          >
            <iframe
              key={frameKey}
              ref={iframeRef}
              title={PREVIEW_FRAME_TITLE}
              src={`${path}?${PREVIEW_QUERY_PARAM}=1`}
              onLoad={handleFrameLoad}
              className="block border-0"
              style={{
                width,
                height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * In place of the frame when the site would not show (#865): what happened,
 * that her work is safe, and a way back (design brief §5, §8).
 *
 * A polite `status`, not an `alert` — she can keep editing, and a screen
 * reader should not be cut off mid-sentence. Only the mark carries the
 * maroon, as on the admin LoadError, and Try again is a secondary chip so
 * Save stays the editor's one primary action (§2). Not the admin LoadError
 * itself: that one replaces a whole page and says "Nothing on the site has
 * changed", which is beside the point here.
 */
function FrameFailedNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex w-full max-w-[480px] flex-col items-start gap-4 p-5 sm:p-8"
    >
      <div className="flex flex-row items-start gap-3">
        <CircleAlert
          aria-hidden="true"
          className="text-destructive mt-0.5 size-5 shrink-0"
        />
        <div className="flex flex-col gap-1">
          <p className="text-foreground font-sans text-sm leading-relaxed">
            Couldn&apos;t show the preview — the site may be offline.
          </p>
          <p className="text-muted-foreground font-sans text-sm leading-relaxed">
            Your changes are still here. Keep editing, and try the preview again
            in a moment.
          </p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
