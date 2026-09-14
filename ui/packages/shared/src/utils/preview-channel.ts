import { HomePageData } from "../models";

/**
 * The postMessage protocol the admin's in-editor site preview speaks with
 * the public site running inside its iframe (#239).
 *
 * It lives in the shared package because BOTH apps have to agree on it and
 * neither is allowed to import the other — `test/config/app-boundaries.test.ts`
 * fails a public-to-admin import, and would be right to.
 *
 * The channel is same-origin by construction: the admin is served from
 * `/admin` and the site from `/` on one host (#591), so the iframe needs no
 * cross-origin anything. Both ends still pass `location.origin` as the
 * postMessage target and check `event.origin` on receipt — the frame is
 * navigable by whoever is looking at it, and a preview pane that would
 * accept draft content from any origin is an XSS hole with a friendly name.
 *
 * Payloads are structured-cloned rather than serialized, which is what lets
 * a candidate photo travel as a `File`: the editor sends the picked file
 * itself and the preview renders it through an object URL, so nothing has to
 * be uploaded before she can see it.
 */

/** Query parameter that puts the public app in preview mode. */
export const PREVIEW_QUERY_PARAM = "preview";

/** Sent by the framed site once it is listening. */
export const PREVIEW_READY = "kari-preview-ready";

/** Sent by the editor: the current, unsaved form state. */
export const PREVIEW_OVERRIDES = "kari-preview-overrides";

/**
 * The home page as the editor currently has it. `photoFile` is a photo she
 * has picked but not saved — `null` when she has not picked one, in which
 * case `photo` (the stored image id) is what the preview should render.
 */
export interface HomePageOverride extends HomePageData {
  photoFile: File | null;
}

/**
 * Draft state for every public page the preview knows how to override. One
 * key per page, all optional: an editor sends only its own page, and the
 * site falls back to the deployed data for the rest.
 *
 * Only the home page is wired up so far; the other editors follow one at a
 * time (#239), each adding a key here and a fallback in its public page.
 */
export interface PreviewOverrides {
  homePage?: HomePageOverride;
}

export interface PreviewReadyMessage {
  type: typeof PREVIEW_READY;
}

export interface PreviewOverridesMessage {
  type: typeof PREVIEW_OVERRIDES;
  overrides: PreviewOverrides;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Whether `data` off a `MessageEvent` is the framed site's ready signal.
 *
 * A guard rather than a bare `data.type ===` check at each listener because
 * `MessageEvent.data` is genuinely `any` from anywhere: browser extensions,
 * dev tooling and vite's own HMR client all post into the same window.
 */
export const isPreviewReadyMessage = (
  data: unknown,
): data is PreviewReadyMessage => isRecord(data) && data.type === PREVIEW_READY;

/** Whether `data` off a `MessageEvent` is a well-formed overrides message. */
export const isPreviewOverridesMessage = (
  data: unknown,
): data is PreviewOverridesMessage =>
  isRecord(data) &&
  data.type === PREVIEW_OVERRIDES &&
  isRecord(data.overrides);
