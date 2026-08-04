# Fix: draft blog post metadata publicly readable in S3

**Issue:** [#26](https://github.com/adam26davidson/kari-website/issues/26)
**Date:** 2026-08-04
**Approach:** Server-side split (Approach A, approved)

## Problem

`update_blog_posts_handler` (`api/src/routes/blog.rs`) writes the full blog
post list — including unpublished drafts — to `blog-posts.json` tagged
`public=true`. The public site filters drafts client-side
(`BlogService.getPublicListFromS3`), but anyone fetching
`<s3-url>/blog-posts.json` directly can read draft titles and dates. Draft
*content* (`blog/<id>.html`) is already correctly tagged private; only the
list metadata leaks.

## Design

Split the stored list into two objects, both written by
`update_blog_posts_handler`:

| Key | Tag | Contents | Read by |
|---|---|---|---|
| `blog-posts-all.json` | `public=false` | full list, drafts included | admin API (`GET /blog`) |
| `blog-posts.json` | `public=true` | published posts only | public site, direct from S3 |

### Write path (`update_blog_posts_handler`)

1. Serialize and write the **full** list to `blog-posts-all.json` with
   `public = false`.
2. Filter to `is_published` posts, serialize, and write to
   `blog-posts.json` with `public = true`.

Write order matters: private-first. The two writes are not atomic; if the
second fails, the handler returns an error, the admin retries, and at no
point has a draft been exposed. The stale-public-list window is bounded by
the retry.

### Read path (`list_blog_posts_handler`, authenticated)

1. Read `blog-posts-all.json`.
2. On `S3Error::NotFound`, fall back to reading legacy `blog-posts.json`
   (full list from before this change). This covers the first deploy,
   before the admin's next save creates the private object. Without the
   fallback the admin UI would render an empty list and a save could wipe
   the data — the exact hazard the existing code comment warns about.
3. If both are `NotFound`, return an empty list (new site), as today.

No migration script: the private object is created on the admin's next
save, and the fallback keeps the admin list correct until then. The public
`blog-posts.json` keeps drafts until that first save; this is the current
state of the world, not a regression.

### Unchanged

- **UI:** no changes. The public URL stays `<s3-url>/blog-posts.json`; the
  client-side `isPublished` filter in `BlogService.getPublicListFromS3`
  stays as defense in depth (pinned by `ui/src/services/blog.test.ts`).
- **Models:** the API `BlogPost` struct already has `is_published`
  (serde-renamed `isPublished`); no model changes.
- **Routes/auth:** no new routes; `GET /blog` and `PUT /blog` keep their
  authenticated status.
- **Blog content objects** (`blog/<id>.html`): already tagged correctly.

## Error handling

- Serialization failures and S3 errors map to `AppError::internal` with
  distinct messages per write (full list vs public list) so failures are
  diagnosable.
- Parse failure of the stored list must still be an error, never an empty
  list (preserves the existing wipe-protection behavior).

## Testing

Handler-level tests against the in-memory `ObjectStore` (pattern from
PR #18), in the API integration test suite:

1. `PUT /blog` with a mixed published/draft list →
   - `blog-posts-all.json` contains all posts and is tagged private
   - `blog-posts.json` contains only published posts and is tagged public
2. `GET /blog` returns the full list (drafts included) when
   `blog-posts-all.json` exists.
3. Legacy fallback: only `blog-posts.json` exists (pre-migration state) →
   `GET /blog` returns its full contents.
4. Neither object exists → `GET /blog` returns `[]`.
5. Stored data invalid → `GET /blog` returns 500, not an empty list.

Existing UI test `blog.test.ts` continues to pin the client-side filter;
no UI test changes required.

## Rejected alternatives

- **API-served public list** (make `blog-posts.json` private, add a public
  GET endpoint): couples public page availability to the API, adds a new
  unauthenticated route and UI changes for the same outcome.
- **Field filtering** (blank draft titles in the public object): still
  leaks draft existence and count.
