import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSiteBackground } from "./use-site-background";
import { SiteSettingsService } from "../services/site-settings";

vi.mock("../services/site-settings", () => ({
  SiteSettingsService: {
    getFromS3: vi.fn(),
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const HEADER_COLOR_PROPERTIES = [
  "--header-background",
  "--header-title-color",
  "--header-nav-color",
];

afterEach(() => {
  delete document.body.dataset.customBackground;
  document.body.style.removeProperty("--site-background");
  for (const property of HEADER_COLOR_PROPERTIES) {
    document.body.style.removeProperty(property);
  }
  vi.unstubAllGlobals();
});

/** The three header custom properties as <body> currently has them. */
const headerColors = () =>
  HEADER_COLOR_PROPERTIES.map((property) =>
    document.body.style.getPropertyValue(property),
  );

/**
 * Stand-in for the probe image the hook loads to find out whether this
 * bucket has the directory layout. jsdom never fetches, so the test decides
 * when the load fails.
 */
class ProbeImage {
  static instances: ProbeImage[] = [];
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    ProbeImage.instances.push(this);
  }
}

const stubProbeImage = () => {
  ProbeImage.instances = [];
  vi.stubGlobal("Image", ProbeImage);
  return ProbeImage;
};

describe("useSiteBackground", () => {
  it("applies the custom background named by the settings", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(document.body.dataset.customBackground).toBe("true"),
    );
    expect(document.body.style.getPropertyValue("--site-background")).toBe(
      'url("https://s3.test.local/images/bg.webp/original.webp")',
    );
  });

  it("falls back to the legacy key when the directory layout 404s", async () => {
    // A bucket that migrate-images has not been run against yet: the
    // background image only exists at images/<id>. CSS cannot retry on its
    // own, so the hook probes and rewrites the variable.
    const probe = stubProbeImage();
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() => expect(probe.instances).toHaveLength(1));
    expect(probe.instances[0].src).toBe(
      "https://s3.test.local/images/bg.webp/original.webp",
    );

    probe.instances[0].onerror?.();

    expect(document.body.style.getPropertyValue("--site-background")).toBe(
      'url("https://s3.test.local/images/bg.webp")',
    );
    expect(document.body.dataset.customBackground).toBe("true");
  });

  it("ignores a probe failure that lands after unmount", async () => {
    const probe = stubProbeImage();
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
    });

    const { unmount } = renderHook(() => useSiteBackground());
    await waitFor(() => expect(probe.instances).toHaveLength(1));
    unmount();

    probe.instances[0].onerror?.();

    expect(document.body.dataset.customBackground).toBeUndefined();
    expect(document.body.style.getPropertyValue("--site-background")).toBe("");
  });

  it("keeps the default background when no photo is configured", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(SiteSettingsService.getFromS3).toHaveBeenCalledOnce(),
    );
    expect(document.body.dataset.customBackground).toBeUndefined();
    expect(document.body.style.getPropertyValue("--site-background")).toBe("");
  });

  it("keeps the default background when the settings cannot be fetched", async () => {
    // Covers both a real outage and the settings object simply not
    // existing yet (S3 serves an error for a missing key).
    vi.mocked(SiteSettingsService.getFromS3).mockRejectedValue(
      new Error("Failed to fetch site settings (HTTP 404)"),
    );

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(SiteSettingsService.getFromS3).toHaveBeenCalledOnce(),
    );
    expect(document.body.dataset.customBackground).toBeUndefined();
    expect(document.body.style.getPropertyValue("--site-background")).toBe("");
  });

  it("removes the custom background on unmount", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
    });

    const { unmount } = renderHook(() => useSiteBackground());
    await waitFor(() =>
      expect(document.body.dataset.customBackground).toBe("true"),
    );

    unmount();

    expect(document.body.dataset.customBackground).toBeUndefined();
    expect(document.body.style.getPropertyValue("--site-background")).toBe("");
  });

  it("does not apply a late response after unmount", async () => {
    let resolveFetch: (settings: { backgroundPhoto: string }) => void;
    vi.mocked(SiteSettingsService.getFromS3).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useSiteBackground());
    unmount();
    resolveFetch!({ backgroundPhoto: "bg.webp" });
    // Give the resolved promise's continuation a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.body.dataset.customBackground).toBeUndefined();
    expect(document.body.style.getPropertyValue("--site-background")).toBe("");
  });
});

// The header's bar tint, title and nav colours are admin-settable (#482).
// Each is published as a custom property header.css falls back from, so
// "unset" has to mean "set nothing" — an unset property is what makes the
// stylesheet paint the built-in colour.
describe("useSiteBackground header colours", () => {
  it("applies all three colours from the settings", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "",
      headerBackgroundColor: "#102030cc",
      headerTitleColor: "#ffeedd",
      headerNavColor: "#00ff00",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(headerColors()).toEqual(["#102030cc", "#ffeedd", "#00ff00"]),
    );
    // Colours without a photo: the hook used to return early here, which
    // would have left every one of them unset.
    expect(document.body.dataset.customBackground).toBeUndefined();
  });

  it("applies the colours alongside a custom background photo", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
      headerTitleColor: "#ffeedd",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(document.body.dataset.customBackground).toBe("true"),
    );
    expect(headerColors()).toEqual(["", "#ffeedd", ""]);
  });

  it("leaves the other two alone when only one colour is set", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "",
      headerBackgroundColor: "#102030cc",
      headerTitleColor: "",
      headerNavColor: "",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(headerColors()).toEqual(["#102030cc", "", ""]),
    );
  });

  it("ignores a value that is not a hex colour", async () => {
    // A hand-edited or corrupt settings object must degrade to the
    // built-in appearance, never to an unstyled bar.
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "",
      headerBackgroundColor: "rebeccapurple",
      headerTitleColor: "#fff",
      headerNavColor: "#00ff00; position: fixed",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(SiteSettingsService.getFromS3).toHaveBeenCalledOnce(),
    );
    expect(headerColors()).toEqual(["", "", ""]);
  });

  it("keeps the default colours for a settings object without the fields", async () => {
    // Every site-settings.json written before this feature is this shape.
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "bg.webp",
    });

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(document.body.dataset.customBackground).toBe("true"),
    );
    expect(headerColors()).toEqual(["", "", ""]);
  });

  it("keeps the default colours when the settings cannot be fetched", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockRejectedValue(
      new Error("Failed to fetch site settings (HTTP 404)"),
    );

    renderHook(() => useSiteBackground());

    await waitFor(() =>
      expect(SiteSettingsService.getFromS3).toHaveBeenCalledOnce(),
    );
    expect(headerColors()).toEqual(["", "", ""]);
  });

  it("removes the colours on unmount", async () => {
    vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
      backgroundPhoto: "",
      headerBackgroundColor: "#102030cc",
      headerTitleColor: "#ffeedd",
      headerNavColor: "#00ff00",
    });

    const { unmount } = renderHook(() => useSiteBackground());
    await waitFor(() =>
      expect(headerColors()).toEqual(["#102030cc", "#ffeedd", "#00ff00"]),
    );

    unmount();

    expect(headerColors()).toEqual(["", "", ""]);
  });
});
