// Seeds the local S3 (MinIO) the e2e suite runs against. Idempotent: every
// run recreates the bucket policy and overwrites the seed objects, so tests
// always start from the same known content regardless of what previous runs
// (or admin-journey mutations) left behind.
//
// Run directly (`node e2e/seed.mjs`) or via `npm run test:e2e`, which seeds
// before launching Playwright. The gateway itself is started separately:
//
//   docker run -d --rm --name kari-e2e-s3 -p 9000:9000 \
//     -e MINIO_ROOT_USER=kari-e2e -e MINIO_ROOT_PASSWORD=kari-e2e-secret \
//     minio/minio server /data
//
// The endpoint and bucket are derived from VITE_S3_URL in ui/.env.test (the
// same value the test bundle bakes in), so app, tests, and seeds always
// agree on where the data lives.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

function readTestEnv() {
  const raw = fs.readFileSync(path.join(E2E_DIR, "..", ".env.test"), "utf-8");
  const env = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const s3Url = new URL(process.env.VITE_S3_URL ?? readTestEnv().VITE_S3_URL);
export const S3_ENDPOINT = s3Url.origin;
export const S3_BUCKET = s3Url.pathname.replace(/^\//, "");

// Local-only credentials for the throwaway MinIO instance — not secrets.
const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.E2E_S3_ACCESS_KEY ?? "kari-e2e",
    secretAccessKey: process.env.E2E_S3_SECRET_KEY ?? "kari-e2e-secret",
  },
});

// A tiny valid 1x1 PNG; enough for <img> naturalWidth checks.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNi" +
    "+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg==",
  "base64",
);

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
  { key: "images/seed-home.png", body: PNG, type: "image/png" },
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
      const name = error?.name ?? "";
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists")
        return;
      if (Date.now() > deadline) {
        throw new Error(
          `Local S3 at ${S3_ENDPOINT} is not reachable (${name || error}). ` +
            "Start it with:\n" +
            "  docker run -d --rm --name kari-e2e-s3 -p 9000:9000 \\\n" +
            "    -e MINIO_ROOT_USER=kari-e2e " +
            "-e MINIO_ROOT_PASSWORD=kari-e2e-secret \\\n" +
            "    minio/minio server /data",
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

await seed();
