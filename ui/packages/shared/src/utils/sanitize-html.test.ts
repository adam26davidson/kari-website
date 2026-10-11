import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("strips scripts and inline event handlers", () => {
    const clean = sanitizeHtml(
      '<p>hi</p><script>alert(1)</script><img src="x.png" onerror="alert(2)">',
    );
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("<p>hi</p>");
  });

  it("keeps ordinary post markup: paragraphs, links and images", () => {
    const clean = sanitizeHtml(
      '<p>see <a href="https://example.com">this</a></p><img src="/images/a.jpg">',
    );
    expect(clean).toContain('<a href="https://example.com">this</a>');
    expect(clean).toContain('<img src="/images/a.jpg">');
  });

  // A picture she has inserted but not saved is a data: URL in the editor's
  // HTML; the preview depends on it surviving the sanitizer.
  it("keeps a data: image source", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeHtml(`<img src="${src}" title="pending">`)).toContain(
      `src="${src}"`,
    );
  });
});
