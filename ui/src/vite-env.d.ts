/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_S3_URL: string;
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  /**
   * Sha the bundle was built from, exported by deploy.yml's build job.
   * Absent in local dev and test-mode builds, so consumers must handle
   * undefined (the whats-on-test page shows an "unknown build" fallback).
   */
  readonly VITE_COMMIT_SHA?: string;
  /**
   * "true" only in staging/test builds (.env.staging, .env.test): gates
   * the /whats-on-test route so the prod bundle never registers it.
   */
  readonly VITE_SHOW_TEST_STATUS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
