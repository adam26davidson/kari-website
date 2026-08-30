import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { AdminImageGcPage } from "./admin-image-gc-page";
import { GcReport, ImageService } from "../../../services/images";
import { HttpError } from "../../../services/http-error";
import { answerYes, renderWithAdminUi } from "../admin-ui-test-helpers";

vi.mock("../../../services/images", () => ({
  ImageService: {
    gc: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

/// One image, two stored objects — the shape that made the page count
/// objects and report twice as many images as it swept (#454).
function image(id: string) {
  return {
    id,
    keys: [`images/${id}/original.png`, `images/${id}/thumb.jpg`],
  };
}

const orphans = [image("orphan-1.png"), image("orphan-2.png")];

const dryRunReport: GcReport = {
  dry_run: true,
  referenced: [image("kept-1.png"), image("kept-2.png")],
  orphaned: orphans,
  skipped_recent: [image("fresh.png")],
  deleted: [],
};

const realRunReport: GcReport = {
  ...dryRunReport,
  dry_run: false,
  deleted: orphans,
};

function renderPage() {
  const { adminUi } = renderWithAdminUi(<AdminImageGcPage />);
  return {
    adminUi,
    notify: adminUi.notify,
    showLoading: adminUi.showLoading,
    hideLoading: adminUi.hideLoading,
  };
}

async function clickPreview() {
  await act(async () => {
    fireEvent.click(screen.getByText("Preview cleanup"));
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminImageGcPage dry run", () => {
  it("calls the endpoint in dry-run mode and renders the report", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    renderPage();

    await clickPreview();

    expect(ImageService.gc).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledWith(true, expect.any(Function));
    // Counts are IMAGES, not the objects each image stores: five images
    // across the three categories, ten objects between them.
    expect(
      screen.getByText(
        "Preview: 2 images are no longer used by any page and would be " +
          "deleted, 2 still in use, 1 uploaded in the last hour and left " +
          "alone. Nothing has been deleted.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("No longer used (would be deleted) (2)"),
    ).toBeTruthy();
    expect(screen.getByText("Still in use (kept) (2)")).toBeTruthy();
    expect(
      screen.getByText("Uploaded in the last hour (kept) (1)"),
    ).toBeTruthy();
    // Every image shows as a picture, one thumbnail each (#495).
    for (const id of [
      "orphan-1.png",
      "orphan-2.png",
      "kept-1.png",
      "kept-2.png",
      "fresh.png",
    ]) {
      const thumb = screen.getByAltText(id);
      expect(thumb).toHaveAttribute(
        "src",
        `https://api.test.local/images/${id}?size=thumb`,
      );
      expect(thumb).toHaveAttribute("loading", "lazy");
      expect(thumb).toHaveAttribute("decoding", "async");
    }
    // Storage keys are the code's vocabulary, not hers — the report shows
    // pictures instead (#495).
    for (const key of [
      "images/orphan-1.png/original.png",
      "images/orphan-1.png/thumb.jpg",
      "images/fresh.png/original.png",
    ]) {
      expect(screen.queryByText(key)).toBeNull();
    }
  });

  it("shows a plain placeholder for a picture that will not load", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue({
      ...dryRunReport,
      orphaned: [image("orphan-1.png")],
      referenced: [],
      skipped_recent: [],
    });
    renderPage();
    await clickPreview();

    fireEvent.error(screen.getByAltText("orphan-1.png"));

    // No broken-image icon: a quiet tile that says what happened.
    expect(screen.queryByAltText("orphan-1.png")).toBeNull();
    expect(screen.getByText("Couldn't show this picture")).toBeTruthy();
  });

  // The placeholder tells her to preview again, so previewing again has to
  // actually retry the picture: a load failure is usually a passing network
  // blip, and a tile stuck on "Couldn't show this picture" would have her
  // confirming permanent deletion of a picture the page refuses to show.
  it("retries a failed picture when a fresh report arrives", async () => {
    const oneOrphan = {
      ...dryRunReport,
      orphaned: [image("orphan-1.png")],
      referenced: [],
      skipped_recent: [],
    };
    vi.mocked(ImageService.gc).mockResolvedValue(oneOrphan);
    renderPage();
    await clickPreview();

    fireEvent.error(screen.getByAltText("orphan-1.png"));
    expect(screen.getByText("Couldn't show this picture")).toBeTruthy();

    // Same image id in the new report — the tile must still come back.
    vi.mocked(ImageService.gc).mockResolvedValue({ ...oneOrphan });
    await clickPreview();

    expect(screen.queryByText("Couldn't show this picture")).toBeNull();
    expect(screen.getByAltText("orphan-1.png")).toHaveAttribute(
      "src",
      "https://api.test.local/images/orphan-1.png?size=thumb",
    );
  });

  it("invites nothing rather than showing a blank list when a group is empty", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue({
      ...dryRunReport,
      orphaned: [],
      referenced: [],
      skipped_recent: [],
    });
    renderPage();

    await clickPreview();

    expect(screen.getAllByText("Nothing here.")).toHaveLength(3);
  });

  // "1 images are no longer used" would be the plainest possible way to
  // sound like a machine, so the wording agrees with the count.
  it("says it in the singular when exactly one image is unused", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue({
      ...dryRunReport,
      orphaned: [image("orphan-1.png")],
      referenced: [],
      skipped_recent: [],
    });
    renderPage();

    await clickPreview();

    expect(
      screen.getByText(
        "Preview: 1 image is no longer used by any page and would be " +
          "deleted, 0 still in use, 0 uploaded in the last hour and left " +
          "alone. Nothing has been deleted.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Delete 1 unused image")).toBeTruthy();
  });

  it("shows no delete button when the preview finds no orphans", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue({
      ...dryRunReport,
      orphaned: [],
    });
    renderPage();

    await clickPreview();

    expect(screen.queryByText(/^Delete \d/)).toBeNull();
  });

  it("wraps the loading state around the request", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { showLoading, hideLoading } = renderPage();

    await clickPreview();

    expect(showLoading).toHaveBeenNthCalledWith(
      1,
      "Previewing image cleanup...",
    );
    expect(hideLoading).toHaveBeenCalled();
  });
});

describe("AdminImageGcPage real run", () => {
  it("deletes only after explicit confirmation and shows what was deleted", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { notify, adminUi } = renderPage();
    await clickPreview();

    fireEvent.click(screen.getByText("Delete 2 unused images"));

    // No deletion happens before the dialog is confirmed.
    expect(ImageService.gc).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledWith(true, expect.any(Function));
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("permanently delete 2 unused images"),
      expect.any(Function),
    );

    vi.mocked(ImageService.gc).mockResolvedValue(realRunReport);
    await answerYes(adminUi);

    expect(ImageService.gc).toHaveBeenLastCalledWith(
      false,
      expect.any(Function),
    );
    expect(notify).toHaveBeenCalledWith("Deleted 2 unused images");
    expect(screen.getByText("Deleted 2 unused images.")).toBeTruthy();
    expect(screen.getByText("Deleted (2)")).toBeTruthy();
    // Deleted pictures are gone from storage, so asking for their
    // thumbnails would only draw broken images — say so instead (#495).
    expect(screen.queryByAltText("orphan-1.png")).toBeNull();
    expect(
      screen.getByText(
        "These pictures are no longer in storage, so there is nothing left" +
          " to show.",
      ),
    ).toBeTruthy();
    // The real run replaces the preview's delete button and orphan list.
    expect(screen.queryByText("Delete 2 unused images")).toBeNull();
  });

  it("does not run the sweep until the dialog is confirmed", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { adminUi } = renderPage();
    await clickPreview();

    fireEvent.click(screen.getByText("Delete 2 unused images"));

    // The page only hands the dialog to confirm(); the sweep runs only
    // when the provider invokes the Yes callback.
    expect(adminUi.confirm).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledWith(true, expect.any(Function));
  });
});

describe("AdminImageGcPage failures", () => {
  it("surfaces the server's error and clears any stale report", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { notify } = renderPage();
    await clickPreview();

    vi.mocked(ImageService.gc).mockRejectedValue(
      new HttpError(
        "Image cleanup failed (HTTP 500): Image GC aborted before any delete",
        500,
      ),
    );
    await clickPreview();

    expect(notify).toHaveBeenCalledWith("Image cleanup failed", "error");
    expect(screen.getByRole("alert").textContent).toContain(
      "Image cleanup failed (HTTP 500): Image GC aborted before any delete",
    );
    // The stale successful report must not remain visible as if current.
    expect(screen.queryByText(/^Preview: /)).toBeNull();
  });

  it("clears the error once a later run succeeds", async () => {
    vi.mocked(ImageService.gc).mockRejectedValue(new Error("network down"));
    renderPage();
    await clickPreview();
    expect(screen.getByRole("alert")).toBeTruthy();

    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    await clickPreview();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/^Preview: /)).toBeTruthy();
  });
});
