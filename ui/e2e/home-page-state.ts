import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { TEST_S3_URL } from "./helpers";

// Snapshot/restore for the home page. Unlike every other admin section, the
// home page is a single shared document (home-page.json) plus one referenced
// photo, not an append-only list — and the editor's save flow DELETES the old
// photo object before uploading a replacement, so a journey that touches it
// destroys the seeded state with no way to undo through the UI.
//
// These helpers capture the S3-visible state before the journey and put it
// back afterwards, talking to the e2e object store directly with the same
// endpoint/bucket/credential conventions as e2e/seed.mjs. Restore is
// deliberately browser-independent so it still works when a test dies midway
// (failed assertion, timeout, crashed page), and it verifies its own writes
// so a broken restore fails the run loudly instead of silently leaking state.

const s3Url = new URL(TEST_S3_URL);
const S3_ENDPOINT = s3Url.origin;
const S3_BUCKET = s3Url.pathname.replace(/^\//, "");

// Local-only credentials for the throwaway MinIO instance — not secrets.
// Env overrides mirror e2e/seed.mjs so both always target the same store.
const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.E2E_S3_ACCESS_KEY ?? "kari-e2e",
    secretAccessKey: process.env.E2E_S3_SECRET_KEY ?? "kari-e2e-secret",
  },
});

export interface HomePageSnapshot {
  /** Raw text of home-page.json, restored verbatim. */
  json: string;
  /** Photo filename referenced by the snapshot ("" when none). */
  photo: string;
  /** Raw bytes of images/<photo>; null when that object was missing. */
  photoBody: Buffer | null;
  photoContentType: string;
}

/**
 * Capture home-page.json and the image it references, via the same public
 * bucket URLs the visitor-facing app reads. Throws (failing the test before
 * it mutates anything) if the document can't be read.
 */
export async function snapshotHomePage(): Promise<HomePageSnapshot> {
  const jsonResponse = await fetch(`${TEST_S3_URL}/home-page.json`);
  if (!jsonResponse.ok) {
    throw new Error(
      "Cannot snapshot the home page (GET home-page.json returned " +
        `${jsonResponse.status}) — refusing to run a journey that mutates ` +
        "it without a restorable copy.",
    );
  }
  const json = await jsonResponse.text();
  const photo = ((JSON.parse(json) as { photo?: string }).photo ?? "").trim();
  let photoBody: Buffer | null = null;
  let photoContentType = "image/png";
  if (photo) {
    const photoResponse = await fetch(`${TEST_S3_URL}/images/${photo}`);
    if (photoResponse.ok) {
      photoBody = Buffer.from(await photoResponse.arrayBuffer());
      photoContentType =
        photoResponse.headers.get("content-type") ?? photoContentType;
    }
  }
  return { json, photo, photoBody, photoContentType };
}

/**
 * Put the snapshotted state back and clean up any photo the journey
 * uploaded, then verify the public objects really serve the snapshot again.
 * Safe to call whatever state the journey died in.
 */
export async function restoreHomePage(snapshot: HomePageSnapshot) {
  // What did the journey leave behind? Best-effort: if this read fails we
  // still restore; we just can't identify a leftover uploaded photo.
  let leftoverPhoto = "";
  try {
    const current = await fetch(`${TEST_S3_URL}/home-page.json`);
    if (current.ok) {
      const data = (await current.json()) as { photo?: string };
      leftoverPhoto = (data.photo ?? "").trim();
    }
  } catch {
    // Ignore: restoring the snapshot below is what matters.
  }

  // Restore the original state first, so the site is whole again even if
  // the orphan cleanup afterwards fails.
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: "home-page.json",
      Body: snapshot.json,
      ContentType: "application/json",
    }),
  );
  if (snapshot.photo && snapshot.photoBody) {
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `images/${snapshot.photo}`,
        Body: snapshot.photoBody,
        ContentType: snapshot.photoContentType,
      }),
    );
  }

  // Delete the photo the journey uploaded: the editor mints a fresh filename
  // on every save, so a referenced photo that differs from the snapshot's is
  // test debris. Best-effort — an orphaned image object is invisible to the
  // site. (Known gap: a run that dies between the editor's image upload and
  // its home-page.json PUT leaves an unreferenced upload we cannot name.)
  if (leftoverPhoto && leftoverPhoto !== snapshot.photo) {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: `images/${leftoverPhoto}`,
        }),
      );
    } catch {
      // Ignore: orphan cleanup only.
    }
  }

  // Verify the restore took, reading through the same public URLs the app
  // uses — if this throws, the run fails loudly instead of leaking state.
  const restored = await fetch(`${TEST_S3_URL}/home-page.json`);
  if (!restored.ok || (await restored.text()) !== snapshot.json) {
    throw new Error(
      "Home page restore failed: home-page.json does not match the snapshot",
    );
  }
  if (snapshot.photo && snapshot.photoBody) {
    const photoResponse = await fetch(`${TEST_S3_URL}/images/${snapshot.photo}`);
    if (!photoResponse.ok) {
      throw new Error(
        `Home page restore failed: images/${snapshot.photo} is not readable`,
      );
    }
  }
}
