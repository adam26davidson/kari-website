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
   * the admin "What's on test" section (/admin/whats-on-test) so the
   * prod bundle never registers its route or menu entry.
   */
  readonly VITE_SHOW_TEST_STATUS?: string;
  /**
   * "fake" only in dev/test builds (.env.development, .env.test): makes
   * the admin app mount its fake Auth0 session instead of the real one
   * (#266), so local dev, the e2e admin journeys and the screenshot
   * capture need no Auth0 credentials. NEVER set in .env, .env.staging or
   * .env.production, so the deployed bundles fold the branch away and drop
   * the fake entirely. Set it to "auth0" in the environment to opt a dev
   * build back into a real login.
   */
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
