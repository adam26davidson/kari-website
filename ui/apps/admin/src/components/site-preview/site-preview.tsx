import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Monitor, Smartphone } from "lucide-react";
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
  const [device, setDevice] = useState<DeviceName>("computer");
  const [scale, setScale] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The latest overrides, readable from the message listener without making
  // the listener depend on them (which would re-attach it per keystroke).
  const overridesRef = useRef(overrides);

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
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [postOverrides]);

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
        {/* Sized to the SCALED frame, so the shrunk page takes exactly the
            room it looks like it takes. */}
        <div
          className="overflow-hidden"
          style={{ width: width * scale, height: height * scale }}
        >
          <iframe
            ref={iframeRef}
            title={PREVIEW_FRAME_TITLE}
            src={`${path}?${PREVIEW_QUERY_PARAM}=1`}
            className="block border-0"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    </Card>
  );
}
