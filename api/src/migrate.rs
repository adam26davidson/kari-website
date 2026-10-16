//! One-shot migration of an existing bucket to the directory-per-image
//! layout (#273): `migrate-images`, a subcommand of the API binary.
//!
//! What it does: generate every missing derived rendition
//! (`images/<id>/thumb.jpg`, `images/<id>/background.jpg`) for every image
//! the bucket holds an `original.<ext>` for, with the same visibility as that
//! original. It touches nothing outside `images/`. (The one-time rewrite of
//! published blog HTML to the directory layout ran on both buckets on
//! 2026-09-07 and was retired in #906.)
//!
//! It is **idempotent**: a rendition that already exists is not regenerated,
//! so it is safe (and expected) to run again after a deploy, to catch
//! anything uploaded in between. That also makes it the way a NEW variant
//! reaches images uploaded before it existed: re-running the migration
//! backfills only what is missing.
//!
//! Failure model, deliberately asymmetric: a failed list or put ABORTS,
//! because carrying on would write into a bucket whose state we no longer
//! know. A rendition that cannot be produced for one image (an unsupported
//! format, a corrupt upload) is only REPORTED — the serving path falls back
//! to the original, so a missing rendition is a slow image, not a broken
//! one.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use crate::services::image_keys::{id_from_key, original_key, variant_key, ImageVariant};
use crate::services::object_store::ObjectStore;
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
    /// Keys of derived renditions generated.
    pub variants_written: Vec<String>,
    /// One line per rendition that could not be produced. Not fatal.
    pub failed_variants: Vec<String>,
}

impl fmt::Display for MigrationReport {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "renditions written:  {}", self.variants_written.len())?;
        for line in &self.failed_variants {
            writeln!(f, "  ! no rendition: {line}")?;
        }
        Ok(())
    }
}

/// What the bucket already holds for one image id.
#[derive(Default)]
struct ImageState {
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
        if object.key == original_key(id) {
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
        .put_object(&key, rendition.into(), public)
        .await
        .map_err(|e| format!("{id}: could not store {key}: {e}"))?;
    Ok(key)
}

/// Run the migration described in the module docs.
///
/// With `dry_run` nothing is written: the report lists what a real run would
/// generate. A dry run does not decode any image, so it cannot predict which
/// renditions would fail — only a real run reports those.
pub async fn migrate_images(
    store: &dyn ObjectStore,
    dry_run: bool,
) -> Result<MigrationReport, MigrationError> {
    let mut report = MigrationReport::default();
    let images = survey(store).await?;

    // Backfill missing renditions from the stored original.
    for (id, state) in &images {
        // An id with no original stores nothing a rendition can be derived
        // from — a stray object left beside the prefix, or an image whose
        // original has been swept. The check is out here rather than beside
        // the write so a dry run reports exactly what an apply would do.
        if !state.has_original {
            continue;
        }
        let source = original_key(id);
        for variant in ImageVariant::ALL {
            if state.variants.contains(variant.file_name()) {
                continue;
            }
            if dry_run {
                report.variants_written.push(variant_key(id, variant));
                continue;
            }
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

    // `dotenv` has already loaded api/.env, which points at the local S3
    // — running the migration against a dev stack while believing it is
    // pointed at a real bucket is the easiest mistake to make here, so it
    // takes an explicit flag.
    let local = endpoint.contains("localhost") || endpoint.contains("127.0.0.1");
    if local && !args.iter().any(|arg| arg == "--allow-local") {
        // Note the working directory in the recipe: `dotenv` searches the cwd
        // and its ancestors, so from `api/` it finds `api/.env` and refills
        // AWS_ENDPOINT_URL/AWS_REGION/the local S3 keys even when the caller
        // just unset them with `env -u`. Running cargo from the repo root
        // (as scripts/dev.sh does, for the same reason) is what actually
        // leaves the real credential chain in charge.
        eprintln!(
            "Refusing to run against the local endpoint {endpoint} \
             (api/.env sets it). Pass --allow-local to rehearse against \
             the local S3, or run from the REPO ROOT, where there is no .env \
             to load, to target a real bucket:\n  \
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
