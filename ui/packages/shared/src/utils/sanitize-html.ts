import DOMPurify from "dompurify";

/**
 * The one sanitizer between stored or drafted post HTML and the public
 * site's `dangerouslySetInnerHTML`.
 *
 * Its own module rather than a `BlogService` static so both callers — the
 * S3 read in `services/blog.ts` and the admin's draft in the site preview
 * (#859) — share it without the preview path depending on the service, and
 * so the tests that mock `BlogService` wholesale still exercise real
 * sanitizing on the draft path. DOMPurify's defaults keep `data:` image
 * sources, which is how a picture inserted but not yet saved reaches the
 * preview.
 */
export const sanitizeHtml = (html: string): string => DOMPurify.sanitize(html);
