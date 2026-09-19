import { SiteSettings } from "@kari/shared/models";
import {
  composeHexAlpha,
  CONTRAST_AA,
  headerContrast,
  resolveHeaderColors,
  splitHexAlpha,
} from "@kari/shared/utils/color";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { FieldLabel } from "../components/field-label/field-label";
import { cn } from "../components/ui/cn";

/** Stand-ins for the real nav, so the links are judged as words in a row. */
const PREVIEW_LINKS = ["Home", "Haiku", "Photography"];

/**
 * A mount around the colour, not a form field around a value (#640).
 *
 * The admin's surfaces are white and near-white, so a white or near-white
 * choice — which "Site title" and "Page links" both are by default — inside
 * a hairline box read as an EMPTY input rather than as the colour currently
 * set, while the dark green "Bar" beside it read correctly. A mid warm grey
 * the fill contrasts with at BOTH ends of the range fixes that once for
 * every choice rather than only for the light end.
 *
 * The two pseudo-element rules are the other half of it: both engines draw
 * the fill in a pseudo-element with a UA border of their own, and stating
 * it keeps the mount's inner edge one deliberate hairline everywhere
 * instead of a per-engine default. That hairline is what makes a white
 * fill a chip in its own right even where the mount is not visible.
 *
 * Arbitrary values throughout because none of this is in the palette: the
 * mount is a neutral backing for whatever colour she picks, deliberately
 * outside the theme so a palette change cannot make it match a swatch.
 */
const SWATCH_CLASSES = cn(
  // Comfortable to hit on a phone, and tall enough that the colour itself
  // is the control rather than a stripe beside a label.
  "h-9 w-[52px] shrink-0 cursor-pointer rounded p-[3px]",
  "border border-[#6f675d] bg-[#8f877c]",
  "[&::-webkit-color-swatch-wrapper]:p-0",
  "[&::-webkit-color-swatch]:rounded-[2px]",
  "[&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-black/40",
  "[&::-moz-color-swatch]:rounded-[2px]",
  "[&::-moz-color-swatch]:border [&::-moz-color-swatch]:border-black/40",
);

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
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {/* The three rows read as one group of settings, so their swatches
          line up in a column instead of each starting wherever its own
          label happened to end ("Bar" vs "Page links" put them ~50px
          apart). A min-width rather than a fixed one: a longer label is
          still allowed to push its own row wider rather than being
          clipped, and at 390px the row simply wraps. */}
      <FieldLabel htmlFor={id} className="min-w-[92px]">
        {label}
      </FieldLabel>
      <input
        id={id}
        type="color"
        className={SWATCH_CLASSES}
        value={value}
        onChange={(event) => onPick(event.target.value)}
      />
      {children}
      {!isDefault && (
        <Button variant="secondary" size="sm" onClick={onUseDefault}>
          Use default
        </Button>
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
 *
 * The warning wears the admin's maroon, which is what
 * `docs/design/admin-redesign/Appearance.png` draws it in. That is a
 * change from the lone warm brown this note carried before the page
 * migrated: the maroon is the admin's one "look at this" colour and is
 * already the softer, non-shouting red the brief asks for, so spending a
 * seventh colour here bought nothing but drift.
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
      className={cn(
        "max-w-[60ch] font-sans text-sm leading-relaxed",
        readable ? "text-muted-foreground" : "text-destructive",
      )}
    >
      {readable ? messages[0] : messages[1] + ADVICE}
    </p>
  );
}

/** Names the slider, which has no <input> for a `for` to point at. */
const SEE_THROUGH_LABEL_ID = "header-bar-see-through-label";

/**
 * The header-colour half of the Appearance page: the bar, the site title
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
    <div className="flex min-w-0 flex-col items-start gap-4">
      <h3 className="text-foreground font-serif text-xl italic">
        Header colours
      </h3>
      <p className="text-muted-foreground max-w-[60ch] font-sans text-sm leading-relaxed">
        The bar across the top of every page. The preview shows your three
        colours together, the way a visitor sees them; the bar can be left
        part see-through so the photograph shows behind it.
      </p>

      {/* A stand-in for the photograph behind the real bar: light at one
          end and dark at the other, because that variation along the bar's
          own length is what a see-through tint has to survive (#392). */}
      <div className="w-full overflow-hidden rounded-lg bg-[linear-gradient(90deg,#efe9dd_0%,#8d8a72_55%,#34382a_100%)]">
        {/* `header-colors-preview-bar` is not styling — it is how this
            section's test finds the bar to read the composed colour off
            (header-colors-section.test.tsx). */}
        <div
          className="header-colors-preview-bar flex flex-wrap items-baseline gap-x-5 gap-y-1.5 px-3.5 py-3 font-sans"
          style={{ backgroundColor: barColor }}
        >
          {/* The weight comes from the site's own token, so the preview
              follows whatever the Fonts card below is set to. Inline
              because it is a variable reference, which Tailwind's
              arbitrary `font-[…]` cannot tell from a family name. */}
          <span
            className="text-[22px] whitespace-nowrap"
            style={{
              color: colors.title,
              fontWeight: "var(--display-weight)",
            }}
          >
            Kari Davidson
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
            {PREVIEW_LINKS.map((link) => (
              <span key={link} style={{ color: colors.nav }}>
                {link}
              </span>
            ))}
          </span>
        </div>
      </div>

      {usingDefaults && (
        <p className="text-muted-foreground font-sans text-sm">
          These are the site&apos;s built-in colours.
        </p>
      )}

      <div className="flex w-full min-w-0 flex-col gap-3">
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
          <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-2">
            {/* A span, not a label: the slider's role sits on a Radix thumb
                rather than on an <input>, so the words reach it through
                `aria-labelledby` instead of `for`. Quieter than the row's
                own label because it is an aside INSIDE the bar's setting,
                not a setting of its own. */}
            <FieldLabel
              id={SEE_THROUGH_LABEL_ID}
              className="text-muted-foreground shrink-0 font-normal"
            >
              See-through
            </FieldLabel>
            <Slider
              aria-labelledby={SEE_THROUGH_LABEL_ID}
              className="min-w-[90px] max-w-[200px] flex-1"
              min={0}
              max={100}
              value={[seeThrough]}
              onValueChange={([value]) =>
                setBar(colors.background, 1 - value / 100)
              }
            />
            {/* Fixed width so the row does not shuffle as the number does. */}
            <span className="text-muted-foreground w-10 shrink-0 font-sans text-sm tabular-nums">
              {seeThrough}%
            </span>
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
