import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminBackgroundPage } from "./admin-background-page";
import { ImageService } from "@kari/shared/services/images";
import { SiteSettingsService } from "@kari/shared/services/site-settings";
import {
  BackgroundImageError,
  validateBackgroundImage,
} from "@kari/shared/utils/background-image";
import {
  answerNo,
  navigateInTest,
  renderAdminPage,
} from "../admin-ui-test-helpers";
import {
  DEFAULT_FONT_PAIRING as DEFAULT_PAIRING,
  FONT_PAIRINGS,
} from "@kari/shared/utils/fonts";

/** Any pairing that is not the built-in one. */
const CUSTOM_PAIRING = FONT_PAIRINGS[1];

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

// The real validation needs createImageBitmap, which jsdom lacks; its own
// unit tests cover it. Keep the real BackgroundImageError so the page's
// instanceof check runs against the class it uses in production.
vi.mock("@kari/shared/utils/background-image", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@kari/shared/utils/background-image")
  >()),
  validateBackgroundImage: vi.fn(),
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

// The page runs TWO independent loads: the settings (which the heading
// waits on) and the list of already-uploaded images. Waiting only for the
// heading returns while the image list is still in flight, leaving tests
// to interact with a half-loaded page and the second load to re-render it
// underneath them. Wait for both.
async function renderLoaded() {
  const utils = renderPage();
  await screen.findByText("Site background");
  await screen.findByText(/Pick an already-uploaded image/);
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
  // Validation passes in these tests; its rejections are exercised below.
  vi.mocked(validateBackgroundImage).mockResolvedValue(undefined);
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
      await screen.findByText("Failed to load the site's appearance settings."),
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

  it("validates and uploads the untouched file before saving the settings", async () => {
    const { notify, container } = await renderAndPickFile();
    const picked = (container.querySelector('input[type="file"]') as
      HTMLInputElement).files![0];

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );
    expect(validateBackgroundImage).toHaveBeenCalledOnce();
    // The exact File the admin picked, not a browser-downscaled re-encode:
    // the API keeps the original and derives the background from it (#453).
    expect(ImageService.upload).toHaveBeenCalledWith(
      picked,
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
    vi.mocked(validateBackgroundImage).mockRejectedValue(
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

describe("AdminBackgroundPage header colours", () => {
  /** Renders the loaded page and picks a colour in one of the swatches. */
  async function renderAndPickColor(label: string, value: string) {
    const utils = await renderLoaded();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    return utils;
  }

  it("saves the colours alongside the background photo", async () => {
    const { notify } = await renderAndPickColor("Page links", "#00ff00");

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(SiteSettingsService.update).toHaveBeenCalledWith(
        { backgroundPhoto: "current.webp", headerNavColor: "#00ff00" },
        expect.any(Function),
      ),
    );
    // The confirmation names what was actually saved.
    expect(notify).toHaveBeenCalledWith("Header colours saved");
  });

  it("shows the stored colours when the page loads", async () => {
    vi.mocked(SiteSettingsService.getFromApi).mockResolvedValue({
      backgroundPhoto: "current.webp",
      headerTitleColor: "#ffee00",
    });

    await renderLoaded();

    expect(screen.getByLabelText("Site title")).toHaveValue("#ffee00");
  });

  it("keeps the photo confirmation when only the photo changed", async () => {
    const { notify } = await renderLoaded();

    fireEvent.click(screen.getByLabelText("Use other.jpg as the background"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );
  });

  it("keeps the edited colours on screen when the save fails", async () => {
    vi.mocked(SiteSettingsService.update).mockRejectedValue(
      new Error("network down"),
    );
    const { notify } = await renderAndPickColor("Page links", "#00ff00");

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(screen.getByLabelText("Page links")).toHaveValue("#00ff00");
  });
});

describe("AdminBackgroundPage fonts", () => {
  /** Renders the loaded page and chooses a non-default font pairing. */
  async function renderAndPickFonts() {
    const utils = await renderLoaded();
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(CUSTOM_PAIRING.label) }),
    );
    return utils;
  }

  it("saves the chosen pairing by id, alongside everything else", async () => {
    const { notify } = await renderAndPickFonts();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(SiteSettingsService.update).toHaveBeenCalledWith(
        { backgroundPhoto: "current.webp", fontPairing: CUSTOM_PAIRING.id },
        expect.any(Function),
      ),
    );
    expect(notify).toHaveBeenCalledWith("Site fonts saved");
  });

  it("names the whole page when fonts and colours changed together", async () => {
    const { notify } = await renderAndPickFonts();
    fireEvent.change(screen.getByLabelText("Page links"), {
      target: { value: "#00ff00" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Appearance settings saved"),
    );
  });

  it("shows the stored pairing when the page loads", async () => {
    vi.mocked(SiteSettingsService.getFromApi).mockResolvedValue({
      backgroundPhoto: "current.webp",
      fontPairing: CUSTOM_PAIRING.id,
    });

    await renderLoaded();

    expect(
      screen.getByRole("radio", { name: new RegExp(CUSTOM_PAIRING.label) }),
    ).toBeChecked();
  });

  it("treats a pairing put back to the built-in one as no change at all", async () => {
    // Every site-settings.json written before this feature lacks the field,
    // and the picker resolves that to the built-in pairing. Choosing that
    // same pairing stores "", which has to compare equal to the absent
    // field or she is asked to discard an edit she has just undone.
    //
    // The detour through a custom pairing is what makes this test able to
    // fail: the built-in radio starts out checked, and React fires no
    // onChange for a click on an already-checked radio, so clicking it
    // straight away would edit nothing and pass no matter what.
    const { adminUi, router } = await renderAndPickFonts();
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(DEFAULT_PAIRING.label) }),
    );
    expect(
      screen.getByRole("radio", { name: new RegExp(DEFAULT_PAIRING.label) }),
    ).toBeChecked();

    await navigateInTest(router, "/haiku");

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("asks before discarding an unsaved font choice", async () => {
    const { adminUi, router } = await renderAndPickFonts();

    await navigateInTest(router, "/haiku");

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/background");
  });
});

describe("AdminBackgroundPage unsaved-changes guard", () => {
  it("navigates away without confirmation while clean", async () => {
    const { adminUi, router } = await renderLoaded();

    await navigateInTest(router, "/haiku");

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("asks before discarding an unsaved background choice", async () => {
    const { adminUi, router } = await renderLoaded();
    fireEvent.click(
      screen.getByLabelText("Use other.jpg as the background"),
    );

    await navigateInTest(router, "/haiku");

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/background");
  });

  it("asks before discarding an unsaved colour choice", async () => {
    const { adminUi, router } = await renderLoaded();
    fireEvent.change(screen.getByLabelText("Site title"), {
      target: { value: "#ffee00" },
    });

    await navigateInTest(router, "/haiku");

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/background");
  });

  it("treats a colour put back to the default as no change at all", async () => {
    // Settings saved before the colours existed lack the fields entirely,
    // so "put this one back" leaves "" against an absent field. The two
    // mean the same thing and have to compare equal, or she is asked to
    // discard changes she has just undone.
    vi.mocked(SiteSettingsService.getFromApi).mockResolvedValue({
      backgroundPhoto: "current.webp",
    });
    const { adminUi, router } = await renderLoaded();
    fireEvent.change(screen.getByLabelText("Site title"), {
      target: { value: "#ffee00" },
    });
    fireEvent.click(screen.getByText("Use default"));

    await navigateInTest(router, "/haiku");

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("does not block leaving after a save", async () => {
    const { adminUi, notify, router } = await renderAndPickFile();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Site background saved"),
    );

    await navigateInTest(router, "/haiku");

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });
});
