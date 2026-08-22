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
import zlib from "node:zlib";
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
 * S3 key of an uploaded image's untouched original. Each image id owns a
 * key prefix holding the original plus derived renditions (#273), and the
 * public site fetches variants by full path, so the seeds and the state
 * helpers must build the same key the app asks for.
 *
 * Mirrors `s3ImageUrl` in ui/src/utils/image-management-helpers.ts; the e2e
 * suite is its own TypeScript project and cannot import from `src/`.
 *
 * @param {string} id
 * @returns {string}
 */
export function originalKey(id) {
  const extension = /\.[a-zA-Z0-9]{1,16}$/.exec(id)?.[0].toLowerCase() ?? "";
  return `images/${id}/original${extension}`;
}

/**
 * A tiny valid 1x1 PNG (base64); enough for <img> naturalWidth checks.
 * Decode with Buffer.from(TINY_PNG_BASE64, "base64").
 */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNi" +
  "+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg==";

/**
 * A solid-color PNG of the given dimensions. The tiny 1x1 PNG above can't
 * exercise layout (any box fits a 1px image), so seeds that back layout
 * assertions — like the landscape home-page photo — build a real-sized
 * image here instead of embedding hundreds of kilobytes of fixture.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function makeSolidPng(width, height) {
  /** @type {number[]} */
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  /** @param {Buffer} buf */
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /** @param {string} type @param {Buffer} data */
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  // A slate-gray raster; each row is a filter byte then width RGB triples.
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 3, 0x88),
  ]);
  const raster = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raster)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** How to start the throwaway MinIO instance the suite expects. */
export const MINIO_START_COMMAND =
  "  docker compose up -d --wait minio   (from the repo root)";

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
