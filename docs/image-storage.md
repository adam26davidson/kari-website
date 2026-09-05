# Image Storage, GC and Bucket Migration

Reference detail for how uploaded images are stored in S3, how orphans are
swept, and how to migrate a bucket to the current layout. CLAUDE.md points
here before you touch image upload/storage/GC code or run a migration.

## Storage layout

Every uploaded image owns a key PREFIX, not one object:

- `images/<id>/original.<ext>` — the untouched upload
- `images/<id>/thumb.jpg` — generated server-side at upload time; admin
  grids and previews render it
- `images/<id>/background.jpg` — generated the same way, at a 2560 px long
  edge; what the public site paints as the page background (#453)

The id is still the `<uuid>.<ext>` name `POST /images` returns, so every
stored reference (`backgroundPhoto`, `haiga.image`, …) is unchanged and
only URL construction knows about variants: the API takes
`GET /images/<id>?size=thumb|background` (falling back to the original when
a variant is missing), while the public site, reading S3 directly, fetches
the full path.

Both derived variants are JPEG whatever the original was — the pure-Rust
`image` crate encodes JPEG natively and has no lossy WebP encoder — so
their names are FIXED, not `background.<ext>`. Every rendition of one
upload comes from a single decode (`make_renditions`), and the migration
backfills one at a time (`make_rendition`).

`api/src/services/image_keys.rs` is the ONE place key shapes live — build
keys there, never by string-formatting. Adding a variant means adding it to
`ImageVariant` (which `ImageVariant::ALL` feeds to both the upload handler
and the migration), to the TS union in
`ui/packages/shared/src/utils/image-management-helpers.ts`, and then
re-running `migrate-images --apply` to backfill it for existing images.

## Image GC

`POST /images/gc` (admin JWT) sweeps orphaned `images/` objects. Dry-run by
default; pass `?dry_run=false` to actually delete. Objects modified within
the last hour are always skipped (in-flight uploads), and any manifest
fetch/parse failure aborts the sweep before anything is deleted.

It classifies per IMAGE, not per object, so a whole prefix is kept, skipped
or deleted together — and reports that way too: `referenced`, `orphaned`,
`skipped_recent` and `deleted` each hold one `{ id, keys }` entry per
image, id-sorted, so the admin page's counts are counts of pictures rather
than of storage objects (#454).

Don't press "Image cleanup" between migrating a bucket and deploying the
code that understands it.

## Bucket migration (`migrate-images`)

`migrate-images`, a subcommand of the API binary, copies legacy
`images/<name>` objects into the new layout, backfills every missing
derived variant and rewrites the S3 URLs in published blog HTML. Dry-run by
default, and idempotent, so run it, deploy, then run it again to catch
uploads in between.

Because it writes only what is absent, re-running it is also how a NEWLY
added variant reaches images uploaded before it existed — deploy first,
then re-run with `--apply`. Until that run, the public site's fallback
chain (variant → original → legacy key) covers the gap.

Run it from the REPO ROOT (not from `api/`):

```
BUCKET_NAME=test.karidavidson.com cargo run --manifest-path api/Cargo.toml \
  -- migrate-images [--apply]
```

### The working directory is load-bearing

For the same reason `scripts/dev.sh` starts the API from the root: `dotenv`
searches the cwd and its ancestors, so from `api/` it loads `api/.env` and
sets `AWS_ENDPOINT_URL` to the dev stack's MinIO, `AWS_REGION` to
`us-east-1` and the `kari-e2e` static keys.

Unsetting them on the command line does NOT help — `env -u` makes them
unset, which is exactly the case `dotenv` fills in — so from `api/` the
command refuses to run ("Refusing to run against the local endpoint"), and
adding `--allow-local` to get past that migrates local MinIO while you
believe you are migrating the real bucket. From the root there is no `.env`
to find, so the SSO credential chain and profile region are in charge.

`--allow-local` is only for a deliberate rehearsal against the dev stack
(run it from `api/`, where `api/.env` supplies MinIO's endpoint and keys).

### Migrate before deploying

The migration is copy-only — the legacy objects stay — but it is not
optional before a deploy of the code that reads the new layout: the API
falls back to the legacy key, yet the PUBLIC site reads S3 directly, and S3
has no fallback of its own.

The UI therefore retries a failed public image at `images/<id>`
(`fallBackToLegacyS3Image` in `image-management-helpers.ts`, wired into
every public `<img>` and the injected blog HTML), so an unmigrated bucket
costs one wasted request per image rather than a broken page. The
site-background hook has its own longer chain for the same reason
(`use-site-background.ts`): `background.jpg` → `original.<ext>` →
`images/<id>`. Migrate anyway, promptly — the fallback is a safety net, not
the intended path, and it retires with the legacy layout (#452).

### Caveat for local rehearsals

MinIO is filesystem-backed and will not LIST `images/<id>/…` while an
object exists at the exact key `images/<id>`, so a rehearsal there cannot
exercise the both-layouts-coexist paths (real S3, which the deployed
buckets are, lists both).
