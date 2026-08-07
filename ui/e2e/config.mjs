// Shared configuration for the local S3 (MinIO) stack the e2e suite runs
// against. This is the one place that owns the `.env.test` parsing and the
// endpoint/bucket/credential conventions, so seed.mjs, helpers.ts, and
// home-page-state.ts always agree on where the data lives.
//
// Plain ESM JavaScript (with JSDoc types) on purpose: it is imported both by
// Node directly (`node e2e/seed.mjs`) and by the TypeScript e2e code, which
// type-checks it via tsconfig.e2e.json's allowJs/checkJs.
//
// Importing this module reads `.env.test` but never touches the network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The test-environment settings, read from ui/.env.test — the same file
 * `npm run build:test` bakes into the bundle, so specs, seeds, and app
 * always agree.
 *
 * @returns {Record<string, string>}
 */
export function readTestEnv() {
  const raw = fs.readFileSync(path.join(E2E_DIR, "..", ".env.test"), "utf-8");
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

// Real environment variables win over the file, mirroring Vite's own
// precedence (useful locally, e.g. to point at an API on another port).
const testEnv = readTestEnv();
export const TEST_API_URL = process.env.VITE_API_URL ?? testEnv.VITE_API_URL;
export const TEST_S3_URL = process.env.VITE_S3_URL ?? testEnv.VITE_S3_URL;

// The S3 endpoint and bucket are derived from VITE_S3_URL (the value the
// test bundle bakes in), so app, tests, and seeds always target the same
// store.
const s3Url = new URL(TEST_S3_URL);
export const S3_ENDPOINT = s3Url.origin;
export const S3_BUCKET = s3Url.pathname.replace(/^\//, "");

/**
 * A tiny valid 1x1 PNG (base64); enough for <img> naturalWidth checks.
 * Decode with Buffer.from(TINY_PNG_BASE64, "base64").
 */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNi" +
  "+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg==";

/** How to start the throwaway MinIO instance the suite expects. */
export const MINIO_START_COMMAND =
  "  docker run -d --rm --name kari-e2e-s3 -p 9000:9000 \\\n" +
  "    -e MINIO_ROOT_USER=kari-e2e " +
  "-e MINIO_ROOT_PASSWORD=kari-e2e-secret \\\n" +
  "    minio/minio server /data";

/**
 * An S3 client targeting the local e2e store. Constructing it opens no
 * connection. Local-only credentials for the throwaway MinIO instance — not
 * secrets; the env overrides let a non-default MinIO be targeted without
 * code changes.
 *
 * @returns {S3Client}
 */
export function createS3Client() {
  return new S3Client({
    endpoint: S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.E2E_S3_ACCESS_KEY ?? "kari-e2e",
      secretAccessKey: process.env.E2E_S3_SECRET_KEY ?? "kari-e2e-secret",
    },
  });
}
