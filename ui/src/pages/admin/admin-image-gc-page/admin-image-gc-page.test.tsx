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
    fireEvent.click(screen.getByText("Preview cleanup (dry run)"));
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
        "Preview: 2 orphaned, 2 referenced, 1 skipped as recent. " +
          "Nothing has been deleted.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Orphaned (would be deleted) (2)")).toBeTruthy();
    expect(screen.getByText("Referenced (kept) (2)")).toBeTruthy();
    expect(
      screen.getByText("Skipped — uploaded within the last hour (1)"),
    ).toBeTruthy();
    // Every image is named once...
    for (const id of [
      "orphan-1.png",
      "orphan-2.png",
      "kept-1.png",
      "kept-2.png",
      "fresh.png",
    ]) {
      expect(screen.getByText(id)).toBeTruthy();
    }
    // ...with its stored objects nested underneath it.
    for (const key of [
      "images/orphan-1.png/original.png",
      "images/orphan-1.png/thumb.jpg",
      "images/orphan-2.png/original.png",
      "images/orphan-2.png/thumb.jpg",
      "images/fresh.png/original.png",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
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

    fireEvent.click(screen.getByText("Delete 2 orphaned images"));

    // No deletion happens before the dialog is confirmed.
    expect(ImageService.gc).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledWith(true, expect.any(Function));
    expect(adminUi.confirm).toHaveBeenCalledWith(
      expect.stringContaining("permanently delete 2 orphaned images"),
      expect.any(Function),
    );

    vi.mocked(ImageService.gc).mockResolvedValue(realRunReport);
    await answerYes(adminUi);

    expect(ImageService.gc).toHaveBeenLastCalledWith(
      false,
      expect.any(Function),
    );
    expect(notify).toHaveBeenCalledWith("Deleted 2 orphaned images");
    expect(screen.getByText("Deleted 2 orphaned images.")).toBeTruthy();
    expect(screen.getByText("Deleted (2)")).toBeTruthy();
    // The real run replaces the preview's delete button and orphan list.
    expect(screen.queryByText("Delete 2 orphaned images")).toBeNull();
  });

  it("does not run the sweep until the dialog is confirmed", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { adminUi } = renderPage();
    await clickPreview();

    fireEvent.click(screen.getByText("Delete 2 orphaned images"));

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
