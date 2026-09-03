import { useEffect } from "react";
import { SiteSettings } from "../models";
import { SiteSettingsService } from "../services/site-settings";
import { isHexColor } from "../utils/color";
import { ensureFontStylesheet, getFontPairing } from "../utils/fonts";
import {
  legacyS3ImageUrl,
  s3ImageUrl,
} from "../utils/image-management-helpers";

const applyBackground = (url: string) => {
  document.body.style.setProperty("--site-background", `url("${url}")`);
  document.body.dataset.customBackground = "true";
};

/**
 * The settings field each header colour is read from, and the custom
 * property header.css reads it back through. Every one of those rules names
 * the built-in colour as its `var()` fallback, so leaving a property unset
 * is exactly "use the default" — which is what an unset, empty or
 * unparseable value has to mean (#482).
 */
const HEADER_COLOR_PROPERTIES: ReadonlyArray<[keyof SiteSettings, string]> = [
  ["headerBackgroundColor", "--header-background"],
  ["headerTitleColor", "--header-title-color"],
  ["headerNavColor", "--header-nav-color"],
];

const applyHeaderColors = (settings: SiteSettings) => {
  for (const [field, property] of HEADER_COLOR_PROPERTIES) {
    // Absent (a settings object written before this feature) and "" both
    // mean "default", and so does anything that is not a hex colour: the
    // stylesheet has to be left holding its own fallback rather than
    // handed a value a browser would either drop or, worse, honour.
    const value = settings[field] ?? "";
    if (isHexColor(value)) {
      document.body.style.setProperty(property, value);
    }
  }
};

/**
 * The custom properties a chosen pairing publishes, mirroring
 * HEADER_COLOR_PROPERTIES: index.css defines all three in `:root`, so
 * leaving them unset is what makes the built-in typefaces paint.
 */
const FONT_PROPERTIES = [
  "--font-body",
  "--font-ui",
  "--display-weight",
] as const;

const applyFontPairing = (settings: SiteSettings) => {
  // Absent, "" and an id we no longer ship all mean "the site's usual
  // fonts", which is the appearance an unset token already produces.
  const pairing = getFontPairing(settings.fontPairing);
  if (!pairing) return;
  // The stylesheet first: the properties below are inert until the faces
  // they name have somewhere to come from.
  ensureFontStylesheet(pairing);
  document.body.style.setProperty("--font-body", pairing.bodyFamily);
  document.body.style.setProperty("--font-ui", pairing.uiFamily);
  // The pairing carries its own light weight because most of these faces
  // have no 300 cut; see utils/fonts.ts.
  document.body.style.setProperty(
    "--display-weight",
    String(pairing.displayWeight),
  );
};

/**
 * Applies the admin-selected site appearance: the background photo, if one
 * is set, the header's bar/title/nav colours, if any are, and — only when
 * the caller opts in — the chosen typeface pairing.
 *
 * The page background is painted by `body::before` (index.css) with the
 * bundled default image. When site-settings.json names a custom photo,
 * this hook sets `data-custom-background` on <body> plus the
 * `--site-background` CSS variable, which a higher-specificity rule in
 * index.css uses to override the default (desktop and mobile variants
 * alike). The header colours work the same way, as custom properties
 * header.css falls back from. Any fetch failure — including the settings
 * object simply not existing yet — leaves the default appearance in place.
 *
 * `applyFonts` is opt-in because BOTH apps call this hook, for the shared
 * background, and the typeface setting is the public site's alone: the
 * admin is a workshop, not a page of the site, and #212/#592 own what it
 * is set in. Only apps/public passes it.
 */
export function useSiteBackground(
  options: { applyFonts?: boolean } = {},
): void {
  const { applyFonts = false } = options;
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      try {
        const settings = await SiteSettingsService.getFromS3();
        if (cancelled) return;
        // Independent of the photo: a site can have custom header colours
        // over the built-in background, so this must not sit behind the
        // "no photo configured" return below.
        applyHeaderColors(settings);
        if (applyFonts) applyFontPairing(settings);
        if (!settings.backgroundPhoto) return;
        const photo = settings.backgroundPhoto;
        applyBackground(s3ImageUrl(photo));
        // CSS has no onError, so probe the directory-layout key separately
        // and swap to the pre-migration one if this bucket has not been
        // migrated yet. The probe hits the same URL the background rule
        // does, so a migrated bucket costs one cached request, not two.
        const probe = new Image();
        probe.onerror = () => {
          if (!cancelled) applyBackground(legacyS3ImageUrl(photo));
        };
        probe.src = s3ImageUrl(photo);
      } catch (error) {
        // The default background is a perfectly good page; never let a
        // missing/unreadable settings object break the site.
        console.error("Using the default site background", error);
      }
    };
    apply();
    return () => {
      cancelled = true;
      delete document.body.dataset.customBackground;
      document.body.style.removeProperty("--site-background");
      for (const [, property] of HEADER_COLOR_PROPERTIES) {
        document.body.style.removeProperty(property);
      }
      // The injected <link> is deliberately left behind; see
      // ensureFontStylesheet.
      for (const property of FONT_PROPERTIES) {
        document.body.style.removeProperty(property);
      }
    };
    // applyFonts is a compile-time choice per app, never a changing value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
