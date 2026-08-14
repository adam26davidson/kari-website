// Seeds the local S3 (MinIO) the e2e suite runs against. Idempotent: every
// run recreates the bucket policy and overwrites the seed objects, so tests
// always start from the same known content regardless of what previous runs
// (or admin-journey mutations) left behind.
//
// Run directly (`node e2e/seed.mjs`) or via `npm run test:e2e`, which seeds
// before launching Playwright. Importing this module has no side effects —
// seeding only happens through the exported `seed()` call (or when the file
// is the entry script). The gateway itself is started separately; the
// endpoint/bucket/credential conventions live in e2e/config.mjs.
import { pathToFileURL } from "node:url";
import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  MINIO_START_COMMAND,
  S3_BUCKET,
  S3_ENDPOINT,
  TINY_PNG_BASE64,
  createS3Client,
  makeSolidPng,
} from "./config.mjs";

const client = createS3Client();

const PNG = Buffer.from(TINY_PNG_BASE64, "base64");

// The home photo is landscape at real-photo dimensions (the production photo
// is 1690x1268) so the visitor spec can catch the card layout overflowing —
// a 1x1 image fits any box and would mask regressions.
const HOME_PHOTO_PNG = makeSolidPng(1600, 1200);

const SEED_BLOG_ID = "seed-blog-1";

/** Objects the public pages read straight from S3 (see ui/src/services). */
const SEED_OBJECTS = [
  {
    key: "home-page.json",
    body: JSON.stringify({
      photo: "seed-home.png",
      blurb: "Seeded e2e home page blurb.",
    }),
    type: "application/json",
  },
  {
    key: "haiku.json",
    body: JSON.stringify([
      {
        id: "seed-haiku-1",
        lines: ["seeded first line", "a stable second line", "third"],
        publisher: "e2e seed",
      },
    ]),
    type: "application/json",
  },
  {
    key: "haiga.json",
    body: JSON.stringify([
      {
        id: "seed-haiga-1",
        lines: ["seeded haiga line"],
        image: "seed-haiga.png",
        publisher: "e2e seed",
      },
    ]),
    type: "application/json",
  },
  {
    key: "photography.json",
    body: JSON.stringify([
      {
        id: "seed-photography-1",
        title: "Seeded photography post",
        subtitle: "seeded subtitle",
        blurb: "seeded blurb",
        images: [{ image: "seed-photo.png", blurb: "seeded caption" }],
      },
    ]),
    type: "application/json",
  },
  {
    key: "blog-posts.json",
    body: JSON.stringify([
      {
        id: SEED_BLOG_ID,
        title: "Seeded published post",
        date: "2026-01-01T00:00:00.000Z",
        isPublished: true,
      },
    ]),
    type: "application/json",
  },
  {
    key: `blog/${SEED_BLOG_ID}.html`,
    body: "<p>Seeded published post content.</p>",
    type: "text/html",
  },
  { key: "images/seed-home.png", body: HOME_PHOTO_PNG, type: "image/png" },
  { key: "images/seed-haiga.png", body: PNG, type: "image/png" },
  { key: "images/seed-photo.png", body: PNG, type: "image/png" },
];

/** The browser fetches these objects unsigned, so the bucket is public-read. */
const PUBLIC_READ_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { AWS: ["*"] },
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${S3_BUCKET}/*`],
    },
  ],
});

async function createBucketWithRetry() {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      return;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists")
        return;
      if (Date.now() > deadline) {
        throw new Error(
          `Local S3 at ${S3_ENDPOINT} is not reachable ` +
            `(${name || String(error)}). Start it with:\n` +
            MINIO_START_COMMAND,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export async function seed() {
  await createBucketWithRetry();
  await client.send(
    new PutBucketPolicyCommand({ Bucket: S3_BUCKET, Policy: PUBLIC_READ_POLICY }),
  );
  for (const object of SEED_OBJECTS) {
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: object.key,
        Body: object.body,
        ContentType: object.type,
      }),
    );
  }
  console.log(
    `Seeded ${SEED_OBJECTS.length} objects into ${S3_ENDPOINT}/${S3_BUCKET}`,
  );
}

// Seed only when run as a script (`node e2e/seed.mjs`), never on import.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await seed();
}
