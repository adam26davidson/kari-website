import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminBackgroundPage } from "./admin-background-page";
import { ImageService } from "@kari/shared/services/images";
import { SiteSettingsService } from "@kari/shared/services/site-settings";
import {
  BackgroundImageError,
  prepareBackgroundImage,
} from "@kari/shared/utils/background-image";
import { answerNo, renderAdminPage } from "../admin-ui-test-helpers";

vi.mock("@kari/shared/services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    list: vi.fn(),
    setPublished: vi.fn(),
  },
}));

vi.mock("@kari/shared/services/site-settings", () => ({
  SiteSettingsService: {
    getFromApi: vi.fn(),
    update: vi.fn(),
  },
}));

// The real preparation needs canvas APIs jsdom lacks; its own unit tests
// cover it. Keep the real BackgroundImageError so the page's instanceof
// check runs against the class it uses in production.
vi.mock("@kari/shared/utils/background-image", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@kari/shared/utils/background-image")
  >()),
  prepareBackgroundImage: vi.fn(),
}));

vi.mock("../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

function renderPage() {
  return renderAdminPage(
    <AdminBackgroundPage />,
    "/:section",
    "/background",
  );
}

async function renderLoaded() {
  const utils = renderPage();
  await screen.findByText("Site background");
  return { ...utils, notify: utils.adminUi.notify };
}

/** Renders the page and picks a replacement file in the PhotoPicker. */
async function renderAndPickFile() {
  const utils = await renderLoaded();
  const input = utils.container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return utils;
}

beforeEach(() => {
  vi.mocked(SiteSettingsService.getFromApi).mockResolvedValue({
    backgroundPhoto: "current.webp",
  });
  vi.mocked(SiteSettingsService.update).mockResolvedValue(undefined);
  vi.mocked(ImageService.list).mockResolvedValue([
    "current.webp",
    "other.jpg",
  ]);
  vi.mocked(ImageService.upload).mockResolvedValue("uploaded.webp");
  vi.mocked(ImageService.setPublished).mockResolvedValue(undefined);
  // The preparation step passes files through untouched in these tests.
  vi.mocked(prepareBackgroundImage).mockImplementation(async (file) => file);
  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AdminBackgroundPage initial load", () => {
  it("shows a load error instead of an empty editor when the load fails", async () => {
    vi.mocked(SiteSettingsService.getFromApi).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();

    expect(
      await screen.findByText("Failed to load the site background settings."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("retries the load and recovers when Retry is clicked", async () => {
    vi.mocked(ImageService.list).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("Site background")).toBeInTheDocument();
    expect(SiteSettingsService.getFromApi).toHaveBeenCalledTimes(2);
  });

  it("labels the built-in background as default when no photo is set", async () => {
    vi.mocked(SiteSettingsService.getFromApi).mockResolvedValue({
      backgroundPhoto: "",
    });

    await renderLoaded();

    expect(screen.getByText("Default background")).toBeInTheDocument();
    expect(
      screen.queryByText("Use default background"),
    ).not.toBeInTheDocument();
  });

  it("offers the already-uploaded images as choices", async () => {
    await renderLoaded();

    expect(
      screen.getByText("Pick an already-uploaded image (2)"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Use other.jpg as the background"),
    ).toBeInTheDocument();
  });

  it("renders the picker grid from thumbnails, lazily", async () => {
    // The grid shows one tile per uploaded image; rendering the full-size
    // originals here downloaded and decoded megabytes per tile (#273).
    await renderLoaded();

    const thumb = screen.getByAltText("other.jpg");
    expect(thumb).toHaveAttribute(
      "src",
      "https://api.test.local/images/other.jpg?size=thumb",
    );
    expect(thumb).toHaveAttribute("loading", "lazy");
    expect(thumb).toHaveAttribute("decoding", "async");
  });
});

describe("AdminBackgroundPage saving", () => {
  it("publishes a picked existing image before referencing it", async () => {
    const { notify } = await renderLoaded();

    fireEvent.click(
      screen.getByLabelText("Use other.jpg as the background"),
    );
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );
    expect(ImageService.upload).not.toHaveBeenCalled();
    expect(ImageService.setPublished).toHaveBeenCalledWith(
      "other.jpg",
      true,
      expect.any(Function),
    );
    expect(SiteSettingsService.update).toHaveBeenCalledWith(
      { backgroundPhoto: "other.jpg" },
      expect.any(Function),
    );
    // The image must be public before the settings reference it.
    const publishOrder =
      vi.mocked(ImageService.setPublished).mock.invocationCallOrder[0];
    const updateOrder =
      vi.mocked(SiteSettingsService.update).mock.invocationCallOrder[0];
    expect(publishOrder).toBeLessThan(updateOrder);
  });

  it("prepares and uploads a new file before saving the settings", async () => {
    const { notify } = await renderAndPickFile();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );
    expect(prepareBackgroundImage).toHaveBeenCalledOnce();
    expect(ImageService.upload).toHaveBeenCalledWith(
      expect.any(File),
      true,
      expect.any(Function),
    );
    expect(SiteSettingsService.update).toHaveBeenCalledWith(
      { backgroundPhoto: "uploaded.webp" },
      expect.any(Function),
    );
    const uploadOrder =
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0];
    const updateOrder =
      vi.mocked(SiteSettingsService.update).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(updateOrder);
    // The upload was already published; no separate publish call.
    expect(ImageService.setPublished).not.toHaveBeenCalled();
    // The new upload joins the picker grid.
    expect(
      screen.getByText("Pick an already-uploaded image (3)"),
    ).toBeInTheDocument();
  });

  it("saves the default (no photo) without touching any image", async () => {
    const { notify } = await renderLoaded();

    fireEvent.click(screen.getByText("Use default background"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );
    expect(SiteSettingsService.update).toHaveBeenCalledWith(
      { backgroundPhoto: "" },
      expect.any(Function),
    );
    expect(ImageService.upload).not.toHaveBeenCalled();
    expect(ImageService.setPublished).not.toHaveBeenCalled();
  });

  it("keeps the settings unsaved when the upload fails", async () => {
    vi.mocked(ImageService.upload).mockRejectedValue(
      new Error("upload failed"),
    );
    const { notify } = await renderAndPickFile();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(SiteSettingsService.update).not.toHaveBeenCalled();
  });

  it("shows the validation message when the file is not a usable image", async () => {
    vi.mocked(prepareBackgroundImage).mockRejectedValue(
      new BackgroundImageError(
        "That file is not an image. Please choose an image file.",
      ),
    );
    const { notify } = await renderAndPickFile();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "That file is not an image. Please choose an image file.",
        "error",
      ),
    );
    expect(ImageService.upload).not.toHaveBeenCalled();
    expect(SiteSettingsService.update).not.toHaveBeenCalled();
  });
});

describe("AdminBackgroundPage unsaved-changes guard", () => {
  it("navigates away without confirmation while clean", async () => {
    const { adminUi, router } = await renderLoaded();

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("asks before discarding an unsaved background choice", async () => {
    const { adminUi, router } = await renderLoaded();
    fireEvent.click(
      screen.getByLabelText("Use other.jpg as the background"),
    );

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/background");
  });

  it("does not block leaving after a save", async () => {
    const { adminUi, notify, router } = await renderAndPickFile();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });
});
