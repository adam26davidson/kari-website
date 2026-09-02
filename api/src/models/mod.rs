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
