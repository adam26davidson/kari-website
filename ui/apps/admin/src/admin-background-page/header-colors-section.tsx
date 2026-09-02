import "./header-colors-section.css";
import { SiteSettings } from "@kari/shared/models";
import {
  composeHexAlpha,
  CONTRAST_AA,
  headerContrast,
  resolveHeaderColors,
  splitHexAlpha,
} from "@kari/shared/utils/color";
import { AdminButton } from "../components/admin-button/admin-button";

/** Stand-ins for the real nav, so the links are judged as words in a row. */
const PREVIEW_LINKS = ["Home", "Haiku", "Photography"];

/** A swatch and its label, with the reset that only appears once it is needed. */
function ColorControl({
  id,
  label,
  value,
  isDefault,
  onPick,
  onUseDefault,
  children,
}: {
  id: string;
  label: string;
  value: string;
  isDefault: boolean;
  onPick: (color: string) => void;
  onUseDefault: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="header-colors-control">
      <label className="header-colors-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        className="header-colors-swatch"
        value={value}
        onChange={(event) => onPick(event.target.value)}
      />
      {children}
      {!isDefault && (
        <AdminButton variant="secondary" onClick={onUseDefault}>
          Use default
        </AdminButton>
      )}
    </div>
  );
}

/** What to do about a pairing that does not read — the same either way. */
const ADVICE =
  " Try a bar colour further away from it — much lighter, or much darker.";

/** Each foreground's [reads clearly, may be hard to read] opening line. */
const NOTES = {
  title: [
    "The site title reads clearly on this bar.",
    "The site title may be hard to read on this bar.",
  ],
  nav: [
    "The page links read clearly on this bar.",
    "The page links may be hard to read on this bar.",
  ],
} as const;

/**
 * How one of the two foregrounds reads on the chosen bar, said plainly.
 * Shown before a save and never blocking one: the numbers are a strict
 * worst case (see headerContrast), so this is advice, not a gate.
 *
 * The ratio itself is deliberately not shown. It is how this sentence is
 * decided, not something the reader can act on — "contrast 9.1 to 1" is the
 * code's vocabulary in a page otherwise written in hers (design brief §3),
 * and the sentence beside it already carries the whole message.
 */
function ContrastNote({
  messages,
  ratio,
}: {
  messages: readonly [string, string];
  ratio: number;
}) {
  const readable = ratio >= CONTRAST_AA;
  return (
    <p
      className={
        readable ? "header-colors-note" : "header-colors-note hard-to-read"
      }
    >
      {readable ? messages[0] : messages[1] + ADVICE}
    </p>
  );
}

/**
 * The header-colour half of the Background page: the bar, the site title
 * and the page links, previewed together because they are only ever seen
 * together (#482). Every control is a swatch rather than a hex field — the
 * one person who uses this is not a developer — and every setting can be
 * put back to the site's built-in colour on its own.
 *
 * Edits are reported upward rather than saved here: the page has one Save
 * button, and these colours ride along with the background photo in the
 * same settings object.
 */
export function HeaderColorsSection({
  settings,
  onChange,
}: {
  settings: SiteSettings;
  onChange: (change: Partial<SiteSettings>) => void;
}) {
  const colors = resolveHeaderColors(settings);
  const contrast = headerContrast(colors);
  const barColor = composeHexAlpha(colors.background, colors.backgroundAlpha);
  // The slider says how much of the photo shows THROUGH the bar, which is
  // the way round it reads on the page; alpha is the other way round.
  const seeThrough = Math.round((1 - colors.backgroundAlpha) * 100);

  const setBar = (color: string, alpha: number) =>
    onChange({ headerBackgroundColor: composeHexAlpha(color, alpha) });

  const usingDefaults =
    !settings.headerBackgroundColor &&
    !settings.headerTitleColor &&
    !settings.headerNavColor;

  return (
    <div className="header-colors">
      <h3 className="header-colors-heading">Header colours</h3>
      <p className="admin-section-explanation">
        The bar across the top of every page. The preview shows your three
        colours together, the way a visitor sees them; the bar can be left
        part see-through so the photograph shows behind it.
      </p>

      <div className="header-colors-preview">
        <div
          className="header-colors-preview-bar"
          style={{ backgroundColor: barColor }}
        >
          <span
            className="header-colors-preview-title"
            style={{ color: colors.title }}
          >
            Kari Davidson
          </span>
          <span className="header-colors-preview-links">
            {PREVIEW_LINKS.map((link) => (
              <span key={link} style={{ color: colors.nav }}>
                {link}
              </span>
            ))}
          </span>
        </div>
      </div>

      {usingDefaults && (
        <p className="header-colors-note">
          These are the site&apos;s built-in colours.
        </p>
      )}

      <div className="header-colors-controls">
        <ColorControl
          id="header-bar-color"
          label="Bar"
          value={colors.background}
          isDefault={!settings.headerBackgroundColor}
          onPick={(color) => setBar(color, colors.backgroundAlpha)}
          onUseDefault={() => onChange({ headerBackgroundColor: "" })}
        >
          {/* One group, so a narrow screen wraps the whole slider onto the
              next line rather than stranding its label on this one. */}
          <span className="header-colors-see-through">
            <label
              className="header-colors-label see-through"
              htmlFor="header-bar-see-through"
            >
              See-through
            </label>
            <input
              id="header-bar-see-through"
              type="range"
              min="0"
              max="100"
              className="header-colors-slider"
              value={seeThrough}
              onChange={(event) =>
                setBar(colors.background, 1 - Number(event.target.value) / 100)
              }
            />
            <span className="header-colors-percent">{seeThrough}%</span>
          </span>
        </ColorControl>

        <ColorControl
          id="header-title-color"
          label="Site title"
          value={splitHexAlpha(colors.title).color}
          isDefault={!settings.headerTitleColor}
          onPick={(color) => onChange({ headerTitleColor: color })}
          onUseDefault={() => onChange({ headerTitleColor: "" })}
        />

        <ColorControl
          id="header-nav-color"
          label="Page links"
          value={splitHexAlpha(colors.nav).color}
          isDefault={!settings.headerNavColor}
          onPick={(color) => onChange({ headerNavColor: color })}
          onUseDefault={() => onChange({ headerNavColor: "" })}
        />
      </div>

      <ContrastNote messages={NOTES.title} ratio={contrast.title} />
      <ContrastNote messages={NOTES.nav} ratio={contrast.nav} />
    </div>
  );
}
