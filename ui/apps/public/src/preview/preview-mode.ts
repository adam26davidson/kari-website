import { PREVIEW_QUERY_PARAM } from "@kari/shared/utils/preview-channel";

/**
 * Whether this document is the admin's preview pane (#239).
 *
 * Two conditions, and both matter. `?preview` is the deliberate opt-in, so
 * an ordinary visit never listens for anything. Being inside a frame is what
 * makes the opt-in meaningful: the site has a real parent to hand its ready
 * signal to, and nobody can be talked into a preview-mode page at the top
 * level by a link. Together they make every listener in
 * `PreviewOverridesProvider` unreachable from the public site as visitors
 * use it, which is what keeps this feature's cost to the public bundle at
 * one `if`.
 *
 * Called once when the provider mounts rather than per render: the pane is
 * a navigable SPA, and a client-side navigation inside it that dropped the
 * query parameter must not switch preview mode off underneath the overrides
 * it has already been handed.
 */
export const isPreviewMode = (): boolean =>
  new URLSearchParams(window.location.search).has(PREVIEW_QUERY_PARAM) &&
  window.parent !== window;
