use serde::{Deserialize, Serialize};

use crate::services::image_keys::ImageVariant;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiku {
    pub id: String,
    pub lines: Vec<String>,
    pub publisher: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiga {
    pub id: String,
    pub lines: Vec<String>,
    pub publisher: String,
    pub image: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HomePageData {
    pub photo: String,
    pub blurb: String,
}

/// Site-wide settings stored as `site-settings.json`. `background_photo` is
/// the `images/` file name the public site uses as its page background; an
/// empty string means "use the built-in default background".
///
/// The three header colours are the admin's overrides for the site header's
/// bar tint, site title and nav links. Each is either an empty string ("use
/// the built-in default", which is what the stylesheet's `var()` fallbacks
/// paint) or a hex colour written by the admin UI: `#rrggbbaa` for the bar
/// (one field carries the translucency the bar needs) and `#rrggbb` for the
/// two text colours. The API stores whatever it is given; the UI validates
/// the format before applying it, so a hand-edited value can only ever
/// degrade to the default appearance.
///
/// `fontPairing` is the same contract in one field: the id of one of the
/// typeface pairings the UI ships (an empty string being the built-in one).
/// The API neither knows nor checks the list — an id it no longer
/// recognises is ignored on the way out, exactly like a malformed colour.
///
/// Every field defaults so a settings object written before any of them
/// existed still parses — important because the image GC treats a parse
/// failure as fatal.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SiteSettings {
    #[serde(rename = "backgroundPhoto", default)]
    pub background_photo: String,
    #[serde(rename = "headerBackgroundColor", default)]
    pub header_background_color: String,
    #[serde(rename = "headerTitleColor", default)]
    pub header_title_color: String,
    #[serde(rename = "headerNavColor", default)]
    pub header_nav_color: String,
    #[serde(rename = "fontPairing", default)]
    pub font_pairing: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlogPost {
    pub id: String,
    pub title: String,
    pub date: String,
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}

/// A post `date` pinned to `YYYY-MM-DDT00:00:00.000Z`, or `None` when the
/// input has no leading ISO calendar day or names an impossible one.
///
/// The Rust counterpart of the UI's `toPostDate`
/// (`ui/packages/shared/src/utils/date-helpers.ts`). `formatPostDate` renders
/// a stored date's UTC calendar day, so a non-midnight or offset timestamp
/// would show a different day than the author picked (#365). The UI has
/// normalized on write since #379, but nothing outside it did (#523) — this
/// closes the write path for every caller.
///
/// It PINS rather than rejects because the admin PUTs the whole post list on
/// every save while rewriting only the edited post's date: posts stored before
/// #379 may still carry creation instants, and rejecting those would 400 every
/// save until each legacy date was hand-edited. Pinning self-heals them.
///
/// The day is taken textually, like `toPostDate`'s string branch: the leading
/// day is the one the string names in its OWN offset ("2026-01-01T17:00-08:00"
/// says Jan 1), which is the day the author picked. `toPostDate`'s fallback for
/// other shapes is deliberately NOT mirrored — it resolves an instant in the
/// local timezone, which is meaningless on a server, so those inputs are
/// rejected instead.
pub fn normalize_post_date(date: &str) -> Option<String> {
    let bytes = date.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    // Anything after the day must be an ISO time, so that a leading day is
    // only trusted when the rest of the string agrees it is a timestamp.
    if bytes.len() > 10 && bytes[10] != b'T' {
        return None;
    }
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }

    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let mut value = 0u32;
        for &byte in &bytes[range] {
            if !byte.is_ascii_digit() {
                return None;
            }
            value = value * 10 + u32::from(byte - b'0');
        }
        Some(value)
    };

    let year = digits(0..4)?;
    let month = digits(5..7)?;
    let day = digits(8..10)?;

    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    // Every byte of the first 10 is ASCII, so this slice is on a char boundary.
    Some(format!("{}T00:00:00.000Z", &date[..10]))
}

/// Days in `month` (1-12) of `year`, applying the full Gregorian leap rule.
fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        _ => 28,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PhotographyImage {
    pub image: String,
    pub blurb: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PhotographyPost {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub blurb: String,
    pub images: Vec<PhotographyImage>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlogPostUpdate {
    pub id: String,
    pub content: String,
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}

#[derive(Deserialize)]
pub struct IsPublishedQuery {
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}

/// Query for `GET /images/:id`. Without `size` the untouched original is
/// served; with it, the named rendition (falling back to the original when
/// that rendition does not exist). The variant set is closed, so an unknown
/// value is a 400 rather than a lookup of a client-supplied key.
#[derive(Deserialize)]
pub struct ImageQuery {
    #[serde(default)]
    pub size: Option<ImageVariant>,
}

/// Query for `POST /images/gc`. Dry-run unless the caller explicitly passes
/// `?dry_run=false` — a GC sweep must never delete by accident.
#[derive(Deserialize)]
pub struct GcQuery {
    #[serde(default = "default_dry_run")]
    pub dry_run: bool,
}

fn default_dry_run() -> bool {
    true
}
