import { useEffect } from "react";
import "./font-pairing-section.css";
import { SiteSettings } from "@kari/shared/models";
import {
  FONT_PAIRINGS,
  FontPairing,
  ensureFontStylesheet,
  resolveFontPairing,
} from "@kari/shared/utils/fonts";

/**
 * What each sample is written in. A line of the site's own kind of writing
 * rather than "The quick brown fox": the choice is being made for haiku, so
 * the sample should be a haiku's worth of words, in both of the scripts the
 * pages carry.
 */
const SAMPLE_LINES = ["Rain on the old stones", "古池や　蛙飛びこむ"];

/** What the second, smaller face is for, shown in that face. */
const SAMPLE_CAPTION = "Buttons, labels and notes look like this";

/** One choice: its name, what it feels like, and what it actually looks like. */
function PairingOption({
  pairing,
  chosen,
  onPick,
}: {
  pairing: FontPairing;
  chosen: boolean;
  onPick: () => void;
}) {
  return (
    <label
      className={
        chosen ? "font-pairing-option chosen" : "font-pairing-option"
      }
    >
      <input
        type="radio"
        name="font-pairing"
        className="font-pairing-radio"
        value={pairing.id}
        checked={chosen}
        onChange={onPick}
      />
      <span className="font-pairing-detail">
        <span className="font-pairing-name">{pairing.label}</span>
        <span className="font-pairing-description">{pairing.description}</span>
        {/* Inline rather than in the stylesheet: the family is data, one
            value per pairing, and the stylesheet's own font-family
            declarations all go through the site's two tokens (#483). */}
        <span
          className="font-pairing-sample"
          data-sample={pairing.id}
          style={{
            fontFamily: pairing.bodyFamily,
            fontWeight: pairing.displayWeight,
          }}
        >
          {SAMPLE_LINES.map((line) => (
            <span key={line} className="font-pairing-sample-line">
              {line}
            </span>
          ))}
        </span>
        <span
          className="font-pairing-caption"
          data-caption={pairing.id}
          style={{ fontFamily: pairing.uiFamily }}
        >
          {SAMPLE_CAPTION}
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
  // Every pairing's stylesheet, not just the chosen one: a sample rendered
  // in a face the browser has not loaded looks exactly like the fallback,
  // which would make several of these options look identical.
  useEffect(() => {
    for (const pairing of FONT_PAIRINGS) ensureFontStylesheet(pairing);
  }, []);

  const chosen = resolveFontPairing(settings.fontPairing);

  return (
    <div className="font-pairing">
      <h3 className="font-pairing-heading">Fonts</h3>
      <p className="admin-section-explanation">
        The typefaces the site&apos;s pages are written in. Each one below is
        shown in its own lettering, so you can pick the one that reads the
        way you want; the first is what the site has always used.
      </p>

      <div className="font-pairing-options">
        {FONT_PAIRINGS.map((pairing) => (
          <PairingOption
            key={pairing.id}
            pairing={pairing}
            chosen={pairing.id === chosen.id}
            onPick={() => onChange({ fontPairing: pairing.id })}
          />
        ))}
      </div>
    </div>
  );
}
