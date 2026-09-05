//! The one place the shape of an `images/` S3 key is decided.
//!
//! Every image is a *directory* (key prefix) rather than a single object, so
//! one upload can hold several renditions of the same picture (#273):
//!
//! ```text
//! images/<id>/original.<ext>   the untouched upload
//! images/<id>/thumb.jpg        the small rendition admin grids render
//! images/<id>/background.jpg   the page-sized rendition the site paints
//! ```
//!
//! The id is exactly the name `POST /images` has always returned
//! (`<uuid>.<ext>`), so every stored reference — `site-settings.json`'s
//! `backgroundPhoto`, `haiga.json`'s `image`, the photography manifest — keeps
//! working untouched and only URL *construction* changed. The cosmetic
//! `<uuid>.jpg/original.jpg` doubling is the price of that zero-rewrite
//! migration.
//!
//! `legacy_key` is the pre-migration single-object layout. It is deliberately
//! temporary: reads fall back to it so a bucket can be migrated after the
//! code ships, and a follow-up removes it once no bucket holds one.

use serde::Deserialize;

/// File name of the small rendition inside an image's prefix. JPEG rather
/// than WebP because the pure-Rust `image` crate encodes JPEG natively,
/// while lossy WebP needs a C library in the cross-compilation container
/// and the crate's own WebP encoder is lossless-only (larger than JPEG for
/// photographs).
pub const THUMB_FILE: &str = "thumb.jpg";

/// File name of the page-sized rendition inside an image's prefix. The site
/// background is fetched by every visitor on every page, so it is served as
/// a rendition rather than as a camera original (#453). JPEG for the same
/// reason as [`THUMB_FILE`], and hence a fixed name rather than one carrying
/// the id's own extension.
pub const BACKGROUND_FILE: &str = "background.jpg";

/// Longest client-supplied extension preserved on a generated object name.
/// Real image extensions are short (".jpeg", ".webp"); anything longer is
/// junk and is dropped rather than stored.
const MAX_EXTENSION_LEN: usize = 16;

/// A rendition of an image other than the original. Closed set: nothing a
/// client sends ever becomes part of an S3 key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageVariant {
    Thumb,
    Background,
}

impl ImageVariant {
    /// Every variant an upload generates, in the order they are written.
    /// Iterating this rather than listing variants at each call site is what
    /// keeps the upload handler and the migration backfill in step as
    /// variants are added.
    pub const ALL: [ImageVariant; 2] = [ImageVariant::Thumb, ImageVariant::Background];

    /// File name of this variant inside an image's prefix.
    pub fn file_name(self) -> &'static str {
        match self {
            ImageVariant::Thumb => THUMB_FILE,
            ImageVariant::Background => BACKGROUND_FILE,
        }
    }
}

/// The key prefix (with trailing slash) holding every rendition of `id`.
pub fn prefix(id: &str) -> String {
    format!("images/{id}/")
}

/// Key of the untouched upload. The extension is taken from the id itself,
/// so `GET` can guess a content type from the key it actually serves.
pub fn original_key(id: &str) -> String {
    format!("images/{id}/original{}", sanitized_extension(id))
}

/// Key of a derived rendition of `id`.
pub fn variant_key(id: &str, variant: ImageVariant) -> String {
    format!("images/{id}/{}", variant.file_name())
}

/// Key of the single object the pre-#273 layout stored an image as.
pub fn legacy_key(id: &str) -> String {
    format!("images/{id}")
}

/// The image id a listed key belongs to: the first path segment under
/// `images/`, whichever layout the key is in. `None` for keys outside the
/// prefix and for the bare `images/` folder marker some S3 tools create.
pub fn id_from_key(key: &str) -> Option<&str> {
    let rest = key.strip_prefix("images/")?;
    let id = rest.split('/').next().unwrap_or(rest);
    (!id.is_empty()).then_some(id)
}

/// The file name's extension (lowercased, with leading dot), or empty when
/// there is no usable one. Only short, purely alphanumeric extensions on a
/// non-empty stem qualify — everything else (no dot, dotfiles like ".png",
/// trailing dots, path or control characters, overlong suffixes) is dropped
/// so no unvetted client bytes ever reach the S3 key.
pub fn sanitized_extension(file_name: &str) -> String {
    match file_name.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && !ext.is_empty()
                && ext.len() <= MAX_EXTENSION_LEN
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            format!(".{}", ext.to_ascii_lowercase())
        }
        _ => String::new(),
    }
}
