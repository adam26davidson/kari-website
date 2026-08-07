import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AdminImageGcPage } from "./admin-image-gc-page";
import { GcReport, ImageService } from "../../../services/images";
import { HttpError } from "../../../services/http-error";

vi.mock("../../../services/images", () => ({
  ImageService: {
    gc: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

const dryRunReport: GcReport = {
  dry_run: true,
  referenced: ["images/kept-1.png", "images/kept-2.png"],
  orphaned: ["images/orphan-1.png", "images/orphan-2.png"],
  skipped_recent: ["images/fresh.png"],
  deleted: [],
};

const realRunReport: GcReport = {
  dry_run: false,
  referenced: ["images/kept-1.png", "images/kept-2.png"],
  orphaned: ["images/orphan-1.png", "images/orphan-2.png"],
  skipped_recent: ["images/fresh.png"],
  deleted: ["images/orphan-1.png", "images/orphan-2.png"],
};

function renderPage() {
  const notify = vi.fn();
  const setLoading = vi.fn();
  const setConfirmation = vi.fn();
  render(
    <AdminImageGcPage
      setLoading={setLoading}
      setConfirmation={setConfirmation}
      notify={notify}
    />,
  );
  return { notify, setLoading, setConfirmation };
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
    expect(
      screen.getByText(
        "Preview: 2 orphaned, 2 referenced, 1 skipped as recent. " +
          "Nothing has been deleted.",
      ),
    ).toBeTruthy();
    // Every key of every category is listed.
    expect(screen.getByText("images/orphan-1.png")).toBeTruthy();
    expect(screen.getByText("images/orphan-2.png")).toBeTruthy();
    expect(screen.getByText("images/kept-1.png")).toBeTruthy();
    expect(screen.getByText("images/kept-2.png")).toBeTruthy();
    expect(screen.getByText("images/fresh.png")).toBeTruthy();
    expect(screen.getByText("Orphaned (would be deleted) (2)")).toBeTruthy();
    expect(screen.getByText("Referenced (kept) (2)")).toBeTruthy();
    expect(
      screen.getByText("Skipped — uploaded within the last hour (1)"),
    ).toBeTruthy();
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
    const { setLoading } = renderPage();

    await clickPreview();

    expect(setLoading).toHaveBeenNthCalledWith(1, {
      isLoading: true,
      message: "Previewing image cleanup...",
    });
    expect(setLoading).toHaveBeenLastCalledWith({
      isLoading: false,
      message: "",
    });
  });
});

describe("AdminImageGcPage real run", () => {
  it("deletes only after explicit confirmation and shows what was deleted", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { notify, setConfirmation } = renderPage();
    await clickPreview();

    fireEvent.click(screen.getByText("Delete 2 orphaned images"));

    // No deletion happens before the dialog is confirmed.
    expect(ImageService.gc).toHaveBeenCalledOnce();
    expect(ImageService.gc).toHaveBeenCalledWith(true, expect.any(Function));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      message: string;
      options: Array<{ label: string; callback: () => void }>;
    };
    expect(confirmation.message).toContain(
      "permanently delete 2 orphaned images",
    );

    vi.mocked(ImageService.gc).mockResolvedValue(realRunReport);
    const yes = confirmation.options.find((o) => o.label === "Yes");
    await act(async () => {
      yes?.callback();
    });

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

  it("does not run the sweep when the dialog is declined", async () => {
    vi.mocked(ImageService.gc).mockResolvedValue(dryRunReport);
    const { setConfirmation } = renderPage();
    await clickPreview();

    fireEvent.click(screen.getByText("Delete 2 orphaned images"));
    const confirmation = setConfirmation.mock.calls.at(-1)?.[0] as {
      options: Array<{ label: string; callback: () => void }>;
    };
    const no = confirmation.options.find((o) => o.label === "No");
    await act(async () => {
      no?.callback();
    });

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
