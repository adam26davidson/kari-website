import { useEffect, useState } from "react";
import { SiteSettings } from "@kari/shared/models";
import {
  FONT_PAIRINGS,
  FontPairing,
  loadPairingFonts,
  resolveFontPairing,
} from "@kari/shared/utils/fonts";
import { cn } from "../components/ui/cn";

/**
 * What each sample is written in. A line of the site's own kind of writing
 * rather than "The quick brown fox": the choice is being made for haiku, so
 * the sample should be a haiku's worth of words, in both of the scripts the
 * pages carry.
 */
const SAMPLE_LINES = ["Rain on the old stones", "古池や　蛙飛びこむ"];

/** What the second, smaller face is for, shown in that face. */
const SAMPLE_CAPTION = "Buttons, labels and notes look like this";

/**
 * Every character a sample puts on screen. Google serves these families
 * split by `unicode-range`, so this is what tells the browser the Japanese
 * line's subset is wanted too — without it a pairing reports itself loaded
 * while half of its sample still paints in the fallback.
 */
const SAMPLE_TEXT = SAMPLE_LINES.join("") + SAMPLE_CAPTION;

/**
 * How long to wait for a face before showing the sample anyway.
 *
 * Six seconds is long enough that an ordinary connection never sees the
 * admission line, and short enough that a stalled request does not leave
 * "Loading this lettering…" sitting there as if the page were broken. The
 * sample is shown after it either way — `display=swap` means a face that
 * does arrive later still swaps in.
 */
const GIVE_UP_WAITING_MS = 6000;

/** Whether a pairing's own lettering is on screen yet. */
type SampleState = "loading" | "ready" | "failed";

/** The built-in pairing is linked from index.html: it is never pending. */
const initialStates = (): Record<string, SampleState> =>
  Object.fromEntries(
    FONT_PAIRINGS.map((pairing) => [
      pairing.id,
      pairing.googleFamilies.length === 0 ? "ready" : "loading",
    ]),
  );

/**
 * Loads every pairing's faces — not just the chosen one — and says which of
 * them are actually ready to be looked at (#816).
 *
 * Every pairing at once because a sample rendered in a face the browser has
 * not downloaded paints in the FALLBACK, and these pairings all fall
 * through the same one: an unloaded picker shows four identical samples and
 * gives no sign that anything is still coming. Waiting is fine; pretending
 * to have four choices that are secretly one is not.
 */
function useSampleStates(): Record<string, SampleState> {
  const [states, setStates] = useState<Record<string, SampleState>>(
    initialStates,
  );

  useEffect(() => {
    const timers: Array<number> = [];
    const settle = (id: string, state: SampleState) =>
      setStates((previous) => ({ ...previous, [id]: state }));

    for (const pairing of FONT_PAIRINGS) {
      if (pairing.googleFamilies.length === 0) continue;
      // Set before the load is awaited, and deliberately not cancelled by
      // it: a face that arrives after the wait is up still swaps in, and
      // the resolve below then puts the sample's own note away.
      timers.push(
        window.setTimeout(
          () => settle(pairing.id, "failed"),
          GIVE_UP_WAITING_MS,
        ),
      );
      loadPairingFonts(pairing, SAMPLE_TEXT).then(
        () => settle(pairing.id, "ready"),
        () => settle(pairing.id, "failed"),
      );
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return states;
}

/** One choice: its name, what it feels like, and what it actually looks like. */
function PairingOption({
  pairing,
  chosen,
  state,
  onPick,
}: {
  pairing: FontPairing;
  chosen: boolean;
  state: SampleState;
  onPick: () => void;
}) {
  return (
    // The whole card is the label, because the sample IS the label — the
    // target should be the thing she is looking at, not a dot beside it.
    // The chosen one is marked three ways (the radio, the green edge, the
    // tint) since at a glance the samples differ far more than the dots do.
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4",
        "transition-colors",
        chosen
          ? "border-primary ring-primary bg-primary/5 ring-1 ring-inset"
          : "border-border hover:border-primary/60",
      )}
    >
      <input
        type="radio"
        name="font-pairing"
        className="accent-primary mt-1 shrink-0 cursor-pointer"
        value={pairing.id}
        checked={chosen}
        onChange={onPick}
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-foreground font-sans text-[15px] font-medium">
          {pairing.label}
        </span>
        <span className="text-muted-foreground font-sans text-sm [overflow-wrap:anywhere]">
          {pairing.description}
        </span>
        {/* A fixed floor under the sample block so a card does not grow
            under her hand the moment its lettering arrives. */}
        <span className="mt-1.5 flex min-h-[84px] flex-col justify-center gap-1">
          {state === "loading" ? (
            <span className="text-muted-foreground font-sans text-sm">
              Loading this lettering…
            </span>
          ) : (
            <>
              {/* Inline rather than in a class: the family is data, one
                  value per pairing, and every font-family the admin's
                  stylesheets declare goes through the site's two tokens
                  (#483). */}
              <span
                className="text-foreground flex flex-col gap-0.5 text-xl"
                data-sample={pairing.id}
                style={{
                  fontFamily: pairing.bodyFamily,
                  fontWeight: pairing.displayWeight,
                }}
              >
                {SAMPLE_LINES.map((line) => (
                  <span key={line} className="[overflow-wrap:anywhere]">
                    {line}
                  </span>
                ))}
              </span>
              {/* Ink, not the muted tone (#715): the only thing that should
                  vary between the four captions is the typeface, which is
                  the whole point of the line — a caption a shade paler than
                  its neighbours reads as the pairing being fainter. */}
              <span
                className="text-foreground font-sans text-sm [overflow-wrap:anywhere]"
                data-caption={pairing.id}
                style={{ fontFamily: pairing.uiFamily }}
              >
                {SAMPLE_CAPTION}
              </span>
              {state === "failed" && (
                <span className="text-muted-foreground font-sans text-xs [overflow-wrap:anywhere]">
                  This lettering is still on its way, so the sample may not
                  be showing it yet.
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </label>
  );
}

/**
 * The typeface half of the Appearance page (#483): the fonts the public
 * site's pages are set in, chosen by looking at them.
 *
 * Every option is a sample rendered in the typefaces it offers, so nothing
 * here asks her to know a family name or to imagine what one looks like.
 * The site's usual fonts are the first option rather than a separate reset
 * button, which makes putting them back the same gesture as choosing
 * anything else — and choosing them stores "", the value every reader
 * already treats as "no choice made".
 *
 * Edits are reported upward, not saved here: the page has one Save button,
 * and this rides along with the photo and colours in one settings object.
 */
export function FontPairingSection({
  settings,
  onChange,
}: {
  settings: SiteSettings;
  onChange: (change: Partial<SiteSettings>) => void;
}) {
  const states = useSampleStates();
  const chosen = resolveFontPairing(settings.fontPairing);

  return (
    <div className="flex min-w-0 flex-col items-start gap-4">
      <h3 className="text-foreground font-serif text-xl italic">Fonts</h3>
      <p className="text-muted-foreground max-w-[60ch] font-sans text-sm leading-relaxed">
        The typefaces the site&apos;s pages are written in. Each one below is
        shown in its own lettering, so you can pick the one that reads the
        way you want; the first is what the site has always used.
      </p>

      <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
        {FONT_PAIRINGS.map((pairing) => (
          <PairingOption
            key={pairing.id}
            pairing={pairing}
            chosen={pairing.id === chosen.id}
            state={states[pairing.id]}
            onPick={() => onChange({ fontPairing: pairing.id })}
          />
        ))}
      </div>
    </div>
  );
}
