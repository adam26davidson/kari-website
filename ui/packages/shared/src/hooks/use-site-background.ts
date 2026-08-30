import { useEffect } from "react";
import { SiteSettingsService } from "../services/site-settings";
import {
  legacyS3ImageUrl,
  s3ImageUrl,
} from "../utils/image-management-helpers";

const applyBackground = (url: string) => {
  document.body.style.setProperty("--site-background", `url("${url}")`);
  document.body.dataset.customBackground = "true";
};

/**
 * Applies the admin-selected site background photo, if one is set.
 *
 * The page background is painted by `body::before` (index.css) with the
 * bundled default image. When site-settings.json names a custom photo,
 * this hook sets `data-custom-background` on <body> plus the
 * `--site-background` CSS variable, which a higher-specificity rule in
 * index.css uses to override the default (desktop and mobile variants
 * alike). Any fetch failure — including the settings object simply not
 * existing yet — leaves the default background in place.
 */
export function useSiteBackground(): void {
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      try {
        const settings = await SiteSettingsService.getFromS3();
        if (cancelled || !settings.backgroundPhoto) return;
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
    };
  }, []);
}
