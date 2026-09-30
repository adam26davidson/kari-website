import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3_BUCKET, TEST_S3_URL, createS3Client } from "./config.mjs";

// Snapshot/restore for the site settings. Like the home page, the Appearance
// page edits a single shared document (site-settings.json) rather than an
// append-only list, so its save overwrites whatever was there and nothing in
// the UI can undo a run. Unlike the home page, e2e/seed.mjs writes no such
// object at all, so the usual starting state on a seeded stack is "the site
// has never been configured" — and putting THAT back means deleting the
// object, not writing an empty one: the public site distinguishes the two
// (a missing object is a failed fetch it falls back from, a present one is
// settings it applies).
//
// Same conventions as e2e/home-page-state.ts: the e2e object store is
// reached directly through e2e/config.mjs, restore is browser-independent so
// it still works when a test dies midway, and it verifies its own write so a
// broken restore fails the run loudly instead of leaking state into the next
// one.

/** The key the API stores the settings under (api/src/routes/site_settings.rs). */
const SETTINGS_KEY = "site-settings.json";

const client = createS3Client();

export interface SiteSettingsSnapshot {
  /** Raw text of site-settings.json, or null when there is no such object. */
  json: string | null;
}

/**
 * Capture site-settings.json via the same public bucket URL the visitor-facing
 * app reads. A missing object is a legitimate state, not a failure; anything
 * else throws, failing the test before it mutates anything.
 */
export async function snapshotSiteSettings(): Promise<SiteSettingsSnapshot> {
  const response = await fetch(`${TEST_S3_URL}/${SETTINGS_KEY}`);
  if (response.ok) return { json: await response.text() };
  // The local S3 answers 404 for a missing key in a public bucket; a bucket
  // policy that hides existence answers 403. Both mean "nothing configured
  // yet".
  if (response.status === 404 || response.status === 403) return { json: null };
  throw new Error(
    `Cannot snapshot the site settings (GET ${SETTINGS_KEY} returned ` +
      `${response.status}) — refusing to run a journey that overwrites them ` +
      "without a restorable copy.",
  );
}

/**
 * Put the snapshotted settings back — deleting the object again when there
 * was none — then verify the public URL really serves the snapshot again.
 * Safe to call whatever state the journey died in.
 */
export async function restoreSiteSettings(snapshot: SiteSettingsSnapshot) {
  if (snapshot.json === null) {
    await client.send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: SETTINGS_KEY }),
    );
  } else {
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: SETTINGS_KEY,
        Body: snapshot.json,
        ContentType: "application/json",
      }),
    );
  }

  // Verify through the same public URL the app uses — if this throws, the
  // run fails loudly instead of leaving the next one a configured site.
  const restored = await fetch(`${TEST_S3_URL}/${SETTINGS_KEY}`);
  if (snapshot.json === null) {
    if (restored.ok) {
      throw new Error(
        `Site settings restore failed: ${SETTINGS_KEY} still exists, but ` +
          "the journey started with no settings object at all",
      );
    }
    return;
  }
  if (!restored.ok || (await restored.text()) !== snapshot.json) {
    throw new Error(
      `Site settings restore failed: ${SETTINGS_KEY} does not match the ` +
        "snapshot",
    );
  }
}
