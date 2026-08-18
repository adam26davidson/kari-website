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

afterEach(() => {
  delete document.body.dataset.customBackground;
  document.body.style.removeProperty("--site-background");
});

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
      'url("https://s3.test.local/images/bg.webp")',
    );
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
