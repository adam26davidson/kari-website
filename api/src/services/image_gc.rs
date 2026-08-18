//! Garbage collection of orphaned `images/` objects.
//!
//! The upload-first save ordering (see #53 / #71) deliberately orphans an
//! uploaded image when the subsequent manifest save fails, and best-effort
//! deletes can leave orphans too. This module builds the set of image file
//! names still referenced by any published content so the GC endpoint can
//! delete everything else.
//!
//! Safety model (the invariants the sweep must never break):
//! - A referenced file is NEVER deleted. The reference set is built
//!   over-inclusively: every plausible spelling of a name found in content
//!   (raw, percent-decoded, HTML-entity-decoded) counts as referenced.
//! - Any fetch or parse failure while building the reference set is FATAL.
//!   If one manifest cannot be read, nothing can be proven orphaned, so the
//!   sweep aborts instead of deleting. Only a definitive `NotFound` (the
//!   object legitimately does not exist yet) is treated as "no references".

use std::collections::{BTreeSet, HashSet};
use std::error::Error;
use std::fmt;

use crate::models::{BlogPost, Haiga, HomePageData, PhotographyPost, SiteSettings};
use crate::services::object_store::ObjectStore;
use crate::services::s3::S3Error;

/// A failure that must abort the GC sweep before anything is deleted.
#[derive(Debug)]
pub struct GcError(pub String);

impl fmt::Display for GcError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "image GC aborted: {}", self.0)
    }
}

impl Error for GcError {}

/// Decode `%XX` escapes; invalid or non-UTF-8 sequences leave the input
/// unchanged rather than guessing.
fn percent_decode(input: &str) -> String {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

/// Undo the HTML entity escaping an editor may have applied inside an
/// attribute value (only the entities that can appear in a file name URL).
fn decode_html_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    input
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&#x26;", "&")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

/// Record `name` as referenced, in every spelling it might take as an S3 key.
///
/// Content stores names in different encodings (a JSON manifest holds the raw
/// file name; blog HTML holds a URL where the browser may have percent-encoded
/// it and the editor may have entity-escaped it), while the S3 key is the raw
/// name the file was uploaded under. Inserting all decoded variants keeps the
/// set over-inclusive, which can only ever cause an orphan to be kept — never
/// a referenced file to be deleted.
pub fn add_reference(name: &str, refs: &mut HashSet<String>) {
    if name.is_empty() {
        return;
    }
    let unescaped = decode_html_entities(name);
    refs.insert(percent_decode(name));
    refs.insert(percent_decode(&unescaped));
    refs.insert(unescaped);
    refs.insert(name.to_string());
}

/// Extract every `/images/<name>` reference from a stored blog-content HTML
/// document into `refs`.
///
/// The UI embeds images as `<img src="<host>/images/<name>">` where the host
/// is either the public S3 URL (published posts) or the API URL (drafts), so
/// matching on the `/images/` path segment covers both without knowing the
/// hosts. The name ends at the first character that cannot be part of the
/// path segment in an HTML attribute (quote, whitespace, tag or query
/// delimiter).
pub fn extract_html_image_refs(html: &str, refs: &mut HashSet<String>) {
    const MARKER: &str = "/images/";
    let mut rest = html;
    while let Some(pos) = rest.find(MARKER) {
        let after = &rest[pos + MARKER.len()..];
        let end = after
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '"' | '\'' | '`' | '<' | '>' | '?' | '#' | '\\')
            })
            .unwrap_or(after.len());
        add_reference(&after[..end], refs);
        rest = &after[end..];
    }
}

/// Fetch `key`, distinguishing "definitely absent" (a legitimate empty
/// manifest on a new site) from "could not read" (fatal for the sweep).
async fn fetch_optional(store: &dyn ObjectStore, key: &str) -> Result<Option<Vec<u8>>, GcError> {
    match store.get_object(key).await {
        Ok(data) => Ok(Some(data)),
        Err(S3Error::NotFound) => Ok(None),
        Err(e) => Err(GcError(format!("failed to fetch {key}: {e}"))),
    }
}

fn parse_manifest<T: serde::de::DeserializeOwned>(key: &str, data: &[u8]) -> Result<T, GcError> {
    serde_json::from_slice(data).map_err(|e| GcError(format!("stored {key} is invalid: {e}")))
}

/// Build the full set of image file names referenced by any content the site
/// serves: `haiga.json`, `home-page.json`, `site-settings.json` (the site
/// background photo), `photography.json`, and the HTML of every blog post
/// listed in `blog-posts-all.json` / `blog-posts.json`.
///
/// Errors on ANY fetch or parse failure — see the module docs for why that
/// must abort the sweep.
pub async fn collect_referenced_images(
    store: &dyn ObjectStore,
) -> Result<HashSet<String>, GcError> {
    let mut refs = HashSet::new();

    if let Some(data) = fetch_optional(store, "haiga.json").await? {
        let haiga: Vec<Haiga> = parse_manifest("haiga.json", &data)?;
        for entry in &haiga {
            add_reference(&entry.image, &mut refs);
        }
    }

    if let Some(data) = fetch_optional(store, "home-page.json").await? {
        let home_page: HomePageData = parse_manifest("home-page.json", &data)?;
        add_reference(&home_page.photo, &mut refs);
    }

    // The site background selected in the admin settings is served straight
    // from S3 by every public page; it must never look orphaned.
    if let Some(data) = fetch_optional(store, "site-settings.json").await? {
        let settings: SiteSettings = parse_manifest("site-settings.json", &data)?;
        add_reference(&settings.background_photo, &mut refs);
    }

    if let Some(data) = fetch_optional(store, "photography.json").await? {
        let posts: Vec<PhotographyPost> = parse_manifest("photography.json", &data)?;
        for post in &posts {
            for image in &post.images {
                add_reference(&image.image, &mut refs);
            }
        }
    }

    // Union of both blog lists: `blog-posts-all.json` is the superset today,
    // but reading the public list too costs one GET and protects against any
    // historical state where the two disagree.
    let mut blog_ids = BTreeSet::new();
    for key in ["blog-posts-all.json", "blog-posts.json"] {
        if let Some(data) = fetch_optional(store, key).await? {
            let posts: Vec<BlogPost> = parse_manifest(key, &data)?;
            blog_ids.extend(posts.into_iter().map(|post| post.id));
        }
    }

    for id in blog_ids {
        let key = format!("blog/{id}.html");
        match store.get_object(&key).await {
            Ok(data) => {
                let html = String::from_utf8(data)
                    .map_err(|e| GcError(format!("stored {key} is not valid UTF-8: {e}")))?;
                extract_html_image_refs(&html, &mut refs);
            }
            // A listed post whose content object does not exist contributes
            // no references; that is a definitive answer, not a failure.
            Err(S3Error::NotFound) => {}
            Err(e) => return Err(GcError(format!("failed to fetch {key}: {e}"))),
        }
    }

    Ok(refs)
}
