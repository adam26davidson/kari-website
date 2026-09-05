//! One-shot migration of an existing bucket to the directory-per-image
//! layout (#273): `migrate-images`, a subcommand of the API binary.
//!
//! What it does, in order:
//! 1. copy every legacy `images/<id>` object to `images/<id>/original.<ext>`
//!    (server-side, so the bytes never travel), preserving its `public=` tag;
//! 2. generate every missing derived rendition (`images/<id>/thumb.jpg`,
//!    `images/<id>/background.jpg`) for every image, in either layout, with
//!    the same visibility as its original;
//! 3. rewrite the S3 URLs embedded in PUBLISHED blog HTML from
//!    `/images/<id>` to `/images/<id>/original.<ext>` — the only stored
//!    references that name an object rather than an id.
//!
//! It is **copy-only**: the legacy objects stay, so code deployed before the
//! migration keeps working against a migrated bucket and the deploy order is
//! not load-bearing. Deleting them is a separate, later cleanup.
//!
//! It is **idempotent**: an original that already exists is not re-copied, a
//! rendition that already exists is not regenerated, and HTML already
//! pointing at `/images/<id>/…` is left alone — so it is safe (and expected)
//! to run again after the deploy, to catch anything uploaded in between.
//! That also makes it the way a NEW variant reaches images uploaded before
//! it existed: re-running the migration backfills only what is missing.
//!
//! MinIO caveat: the local dev/e2e stack is MinIO, which is filesystem-backed
//! and will not LIST `images/<id>/…` while an object exists at the exact key
//! `images/<id>` (the objects are stored and readable — `HeadObject` finds
//! them — they just do not appear in a listing). Real S3 has a flat keyspace
//! and lists both, which is what the deployed buckets are. So a `--allow-local`
//! rehearsal against MinIO cannot exercise the both-layouts-coexist paths, and
//! re-running it there looks non-idempotent for exactly those images. The
//! in-memory store in the tests models S3, not MinIO.
//!
//! Failure model, deliberately asymmetric: a failed list, copy, put, or an
//! unreadable/corrupt blog manifest ABORTS, because carrying on would write
//! into a bucket whose state we no longer know. A rendition that cannot be
//! produced for one image (an unsupported format, a corrupt upload) is only
//! REPORTED — the serving path falls back to the original, so a missing
//! rendition is a slow image, not a broken one.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use crate::models::BlogPost;
use crate::services::image_keys::{
    id_from_key, legacy_key, original_key, sanitized_extension, variant_key, ImageVariant,
};
use crate::services::object_store::ObjectStore;
use crate::services::s3::S3Error;
use crate::services::thumbnail::make_rendition;

/// A failure that aborts the migration before any further write.
#[derive(Debug)]
pub struct MigrationError(pub String);

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "image migration aborted: {}", self.0)
    }
}

impl Error for MigrationError {}

/// What the migration did (or, for a dry run, would do).
#[derive(Debug, Default)]
pub struct MigrationReport {
    /// Keys of originals copied out of the legacy layout.
    pub copied: Vec<String>,
    /// Keys of derived renditions generated.
    pub variants_written: Vec<String>,
    /// Keys of blog HTML documents whose image URLs were rewritten.
    pub rewritten: Vec<String>,
    /// One line per rendition that could not be produced. Not fatal.
    pub failed_variants: Vec<String>,
}

impl fmt::Display for MigrationReport {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "originals copied:    {}", self.copied.len())?;
        writeln!(f, "renditions written:  {}", self.variants_written.len())?;
        writeln!(f, "blog posts rewritten: {}", self.rewritten.len())?;
        for line in &self.failed_variants {
            writeln!(f, "  ! no rendition: {line}")?;
        }
        Ok(())
    }
}

/// What the bucket already holds for one image id.
#[derive(Default)]
struct ImageState {
    has_legacy: bool,
    has_original: bool,
    /// File names of the derived renditions already stored, so a variant
    /// added after an image was uploaded is simply one this set lacks.
    variants: BTreeSet<&'static str>,
}

/// Index every object under `images/` by the image id it belongs to.
async fn survey(store: &dyn ObjectStore) -> Result<BTreeMap<String, ImageState>, MigrationError> {
    let objects = store
        .list_objects("images/")
        .await
        .map_err(|e| MigrationError(format!("failed to list images/: {e}")))?;

    let mut images: BTreeMap<String, ImageState> = BTreeMap::new();
    for object in &objects {
        // Skips the bare "images/" folder marker some S3 tools create.
        let Some(id) = id_from_key(&object.key) else {
            continue;
        };
        let state = images.entry(id.to_string()).or_default();
        if object.key == legacy_key(id) {
            state.has_legacy = true;
        } else if object.key == original_key(id) {
            state.has_original = true;
        } else if let Some(variant) = ImageVariant::ALL
            .into_iter()
            .find(|&variant| object.key == variant_key(id, variant))
        {
            state.variants.insert(variant.file_name());
        }
    }
    Ok(images)
}

/// Rewrite every `/images/<id>` occurrence that is NOT already followed by a
/// path segment into `/images/<id>/original<ext>`, for the ids in
/// `known_ids`. Returns `None` when nothing changed.
///
/// Unknown ids are left exactly as they are: an id with no object in the
/// bucket (already swept, or hand-edited content) would only be rewritten
/// into a key that certainly does not exist.
fn rewrite_image_urls(html: &str, known_ids: &BTreeSet<&str>) -> Option<String> {
    const MARKER: &str = "/images/";
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    let mut changed = false;
    while let Some(pos) = rest.find(MARKER) {
        let (before, after_marker) = rest.split_at(pos + MARKER.len());
        out.push_str(before);
        // Same terminator set the GC's reference extraction uses, so the two
        // agree on where an id ends.
        let end = after_marker
            .find(|c: char| {
                c.is_whitespace()
                    || matches!(c, '/' | '"' | '\'' | '`' | '<' | '>' | '?' | '#' | '\\')
            })
            .unwrap_or(after_marker.len());
        let id = &after_marker[..end];
        out.push_str(id);
        // Already a directory-layout URL, or an id we know nothing about.
        let already_migrated = after_marker[end..].starts_with('/');
        if !already_migrated && known_ids.contains(id) {
            out.push_str(&format!("/original{}", sanitized_extension(id)));
            changed = true;
        }
        rest = &after_marker[end..];
    }
    out.push_str(rest);
    changed.then_some(out)
}

/// Ids of every PUBLISHED blog post. Only published content embeds S3 URLs
/// (a draft's images are served through the API, which resolves the id
/// itself), so only published HTML can need rewriting.
async fn published_post_ids(store: &dyn ObjectStore) -> Result<Vec<String>, MigrationError> {
    const KEY: &str = "blog-posts-all.json";
    let data = match store.get_object(KEY).await {
        Ok(data) => data,
        // A site with no posts at all: nothing to rewrite.
        Err(S3Error::NotFound) => return Ok(Vec::new()),
        Err(e) => return Err(MigrationError(format!("failed to fetch {KEY}: {e}"))),
    };
    let posts: Vec<BlogPost> = serde_json::from_slice(&data)
        .map_err(|e| MigrationError(format!("stored {KEY} is invalid: {e}")))?;
    Ok(posts
        .into_iter()
        .filter(|post| post.is_published)
        .map(|post| post.id)
        .collect())
}

/// Generate and store one derived rendition of an image, returning its key.
///
/// `Err` carries a human-readable reason: survivable, recorded in the
/// report, and the image keeps serving its original.
///
/// The source is fetched and decoded per variant rather than once for all of
/// them. This is a one-shot command over a bucket that is mostly already
/// migrated — after the first run only genuinely new variants are missing —
/// so the simpler "generate exactly what is absent" shape is worth more than
/// saving a decode the upload path (which does share one) never pays.
async fn backfill_variant(
    store: &dyn ObjectStore,
    id: &str,
    source_key: &str,
    variant: ImageVariant,
) -> Result<String, String> {
    let public = store
        .get_object_public(source_key)
        .await
        .map_err(|e| format!("{id}: could not read the visibility of {source_key}: {e}"))?;
    let data = store
        .get_object(source_key)
        .await
        .map_err(|e| format!("{id}: could not fetch {source_key}: {e}"))?;
    let rendition = tokio::task::spawn_blocking(move || make_rendition(&data, variant))
        .await
        .map_err(|e| format!("{id}: rendition generation panicked: {e}"))?
        .map_err(|e| format!("{id}: {e}"))?;

    let key = variant_key(id, variant);
    store
        .put_object(&key, rendition, public)
        .await
        .map_err(|e| format!("{id}: could not store {key}: {e}"))?;
    Ok(key)
}

/// Run the migration described in the module docs.
///
/// With `dry_run` nothing is written: the report lists what a real run would
/// copy, generate and rewrite. A dry run does not decode any image, so it
/// cannot predict which renditions would fail — only a real run reports
/// those.
pub async fn migrate_images(
    store: &dyn ObjectStore,
    dry_run: bool,
) -> Result<MigrationReport, MigrationError> {
    let mut report = MigrationReport::default();
    let images = survey(store).await?;

    // 1. Copy legacy objects under their new prefix.
    for (id, state) in &images {
        if state.has_original || !state.has_legacy {
            continue;
        }
        let to = original_key(id);
        report.copied.push(to.clone());
        if dry_run {
            continue;
        }
        store
            .copy_object(&legacy_key(id), &to)
            .await
            .map_err(|e| MigrationError(format!("failed to copy {id} to {to}: {e}")))?;
        tracing::info!("copied {} -> {}", legacy_key(id), to);
    }

    // 2. Backfill missing renditions, from whichever copy of the original
    //    the bucket now holds.
    for (id, state) in &images {
        for variant in ImageVariant::ALL {
            if state.variants.contains(variant.file_name()) {
                continue;
            }
            if dry_run {
                report.variants_written.push(variant_key(id, variant));
                continue;
            }
            // After step 1 the new-layout original exists for every image
            // that had a legacy object; anything else is already in the new
            // layout.
            let source = if state.has_original || state.has_legacy {
                original_key(id)
            } else {
                continue;
            };
            match backfill_variant(store, id, &source, variant).await {
                Ok(key) => {
                    tracing::info!("generated {}", key);
                    report.variants_written.push(key);
                }
                Err(reason) => {
                    tracing::warn!("{}", reason);
                    report.failed_variants.push(reason);
                }
            }
        }
    }

    // 3. Rewrite the S3 URLs in published blog content.
    let known_ids: BTreeSet<&str> = images.keys().map(String::as_str).collect();
    for post_id in published_post_ids(store).await? {
        let key = format!("blog/{post_id}.html");
        let data = match store.get_object(&key).await {
            Ok(data) => data,
            // A listed post with no content object contributes nothing.
            Err(S3Error::NotFound) => continue,
            Err(e) => return Err(MigrationError(format!("failed to fetch {key}: {e}"))),
        };
        let html = String::from_utf8(data)
            .map_err(|e| MigrationError(format!("stored {key} is not valid UTF-8: {e}")))?;
        let Some(rewritten) = rewrite_image_urls(&html, &known_ids) else {
            continue;
        };
        report.rewritten.push(key.clone());
        if dry_run {
            continue;
        }
        store
            .put_object(&key, rewritten.into_bytes(), true)
            .await
            .map_err(|e| MigrationError(format!("failed to rewrite {key}: {e}")))?;
        tracing::info!("rewrote image urls in {}", key);
    }

    Ok(report)
}

/// Entry point of the `migrate-images` subcommand: parse its flags, refuse
/// the footguns, run the migration and print the report. Returns the process
/// exit code.
///
/// Lives here rather than in `main.rs` so the integration tests cover it, and
/// takes `endpoint` (the caller's `AWS_ENDPOINT_URL`) as an argument rather
/// than reading the environment itself, so those tests need no process-wide
/// state. Flags: `--apply` performs the writes (the default is a dry run, so
/// a mistyped bucket cannot damage anything), `--allow-local` permits running
/// against a local endpoint.
pub async fn run_migrate_images_command(
    store: &dyn ObjectStore,
    args: &[String],
    endpoint: &str,
) -> i32 {
    let apply = args.iter().any(|arg| arg == "--apply");

    // `dotenv` has already loaded api/.env, which points at the local MinIO
    // — running the migration against a dev stack while believing it is
    // pointed at a real bucket is the easiest mistake to make here, so it
    // takes an explicit flag.
    let local = endpoint.contains("localhost") || endpoint.contains("127.0.0.1");
    if local && !args.iter().any(|arg| arg == "--allow-local") {
        // Note the working directory in the recipe: `dotenv` searches the cwd
        // and its ancestors, so from `api/` it finds `api/.env` and refills
        // AWS_ENDPOINT_URL/AWS_REGION/the MinIO keys even when the caller
        // just unset them with `env -u`. Running cargo from the repo root
        // (as scripts/dev.sh does, for the same reason) is what actually
        // leaves the real credential chain in charge.
        eprintln!(
            "Refusing to run against the local endpoint {endpoint} \
             (api/.env sets it). Pass --allow-local to rehearse against \
             MinIO, or run from the REPO ROOT, where there is no .env to \
             load, to target a real bucket:\n  \
             BUCKET_NAME=<bucket> cargo run --manifest-path api/Cargo.toml \
             -- migrate-images [--apply]\n\
             (running this from api/ cannot work: dotenv reloads api/.env, \
             so `env -u` does not stick.)"
        );
        return 2;
    }

    match migrate_images(store, !apply).await {
        Ok(report) => {
            print!(
                "{}",
                if apply {
                    ""
                } else {
                    "DRY RUN (pass --apply to write)\n"
                }
            );
            print!("{report}");
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}
