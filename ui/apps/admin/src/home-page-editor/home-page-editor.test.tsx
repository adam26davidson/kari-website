import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePageEditor } from "./home-page-editor";
import { ImageService } from "@kari/shared/services/images";
import { HomePageService } from "@kari/shared/services/home-page";
import {
  answerNo,
  answerYes,
  renderAdminPage,
} from "../admin-ui-test-helpers";

vi.mock("@kari/shared/services/images", () => ({
  ImageService: {
    upload: vi.fn(),
  },
}));

vi.mock("@kari/shared/services/home-page", () => ({
  HomePageService: {
    getFromApi: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// The editor mounts at /admin/home; the hook behind the unsaved-changes
// guard needs a data router, and the /admin/:section pattern also matches
// /admin/haiku, giving the guard tests somewhere to navigate to.
function renderPage() {
  return renderAdminPage(<HomePageEditor />, "/:section", "/home");
}

// Renders the editor and picks a replacement photo — the state right
// before the user hits save.
async function renderAndPickImage() {
  const utils = renderPage();
  const { container, adminUi } = utils;
  const notify = adminUi.notify;
  await screen.findByDisplayValue("hello");
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { ...utils, notify };
}

beforeEach(() => {
  vi.mocked(HomePageService.getFromApi).mockResolvedValue({
    photo: "old.png",
    blurb: "hello",
  });
  vi.mocked(HomePageService.update).mockResolvedValue(undefined);
  vi.mocked(ImageService.upload).mockResolvedValue("new.png");
  // PhotoPicker needs an object URL for the preview of the freshly picked
  // file; spy on the setup.ts polyfill so restoreAllMocks undoes this.
  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("HomePageEditor initial load", () => {
  it("shows a load error instead of an empty editor when the load fails", async () => {
    vi.mocked(HomePageService.getFromApi).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();

    expect(
      await screen.findByText("Failed to load home page data."),
    ).toBeInTheDocument();
    // Never show an empty editor after a failed load — saving it would
    // overwrite the real data.
    expect(screen.queryByLabelText("Welcome text")).not.toBeInTheDocument();
  });

  it("names the page and both of its fields", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Home page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the photo and welcome text at the top/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Photo")).toBeInTheDocument();
    // Wired to the textarea, not merely sitting above it.
    expect(screen.getByLabelText("Welcome text")).toHaveValue("hello");
  });

  it("retries the load and recovers when Retry is clicked", async () => {
    vi.mocked(HomePageService.getFromApi).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderPage();
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByDisplayValue("hello")).toBeInTheDocument();
    expect(HomePageService.getFromApi).toHaveBeenCalledTimes(2);
  });
});

describe("HomePageEditor photo replacement", () => {
  it("keeps the old photo when saving the JSON fails", async () => {
    vi.mocked(HomePageService.update).mockRejectedValueOnce(
      new Error("Failed to save home page data (HTTP 500)"),
    );
    const { notify } = await renderAndPickImage();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // The upload happened first and the attempted save referenced it.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    expect(HomePageService.update).toHaveBeenCalledWith(
      { photo: "new.png", blurb: "hello" },
      expect.any(Function),
    );
  });

  it("keeps the old photo and skips the JSON save when the upload fails", async () => {
    vi.mocked(ImageService.upload).mockRejectedValue(
      new Error("upload failed"),
    );
    const { notify } = await renderAndPickImage();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(HomePageService.update).not.toHaveBeenCalled();
  });

  // ImageService.upload resolves to null rather than throwing when it has
  // no stored name to report. Treat that as a failed upload too: the JSON
  // must not be written with an empty photo reference.
  it("keeps the old photo and skips the JSON save when the upload returns no name", async () => {
    vi.mocked(ImageService.upload).mockResolvedValue(null);
    const { notify } = await renderAndPickImage();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(HomePageService.update).not.toHaveBeenCalled();
  });

  it("saves the new photo and leaves the replaced object in storage", async () => {
    const { notify } = await renderAndPickImage();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Home page saved"));
    // The saved JSON references the upload, which happened first. The
    // replaced photo object is left for the cleanup sweep — it may still
    // be referenced elsewhere (e.g. as the site background).
    expect(HomePageService.update).toHaveBeenCalledWith(
      { photo: "new.png", blurb: "hello" },
      expect.any(Function),
    );
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(HomePageService.update).mock.invocationCallOrder[0],
    );
  });
});

describe("HomePageEditor unsaved-changes guard", () => {
  it("navigates away without confirmation while clean", async () => {
    const { adminUi, router } = renderPage();
    await screen.findByDisplayValue("hello");

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("asks before discarding an edited blurb and stays on No", async () => {
    const { adminUi, router } = renderPage();
    const textarea = await screen.findByDisplayValue("hello");
    fireEvent.change(textarea, { target: { value: "changed blurb" } });

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/home");
    expect(screen.getByDisplayValue("changed blurb")).toBeInTheDocument();
  });

  it("asks before discarding a freshly picked photo and leaves on Yes", async () => {
    const { adminUi, router } = await renderAndPickImage();

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerYes(adminUi);
    expect(router.state.location.pathname).toBe("/haiku");
    expect(HomePageService.update).not.toHaveBeenCalled();
  });

  it("does not block leaving after the edits were saved", async () => {
    const { adminUi, notify, router } = await renderAndPickImage();
    fireEvent.change(screen.getByDisplayValue("hello"), {
      target: { value: "changed blurb" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Home page saved"));

    await act(async () => {
      router.navigate("/haiku");
    });

    expect(router.state.location.pathname).toBe("/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("keeps guarding after a failed save", async () => {
    vi.mocked(HomePageService.update).mockRejectedValueOnce(
      new Error("Failed to save home page data (HTTP 500)"),
    );
    const { adminUi, notify, router } = await renderAndPickImage();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
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
    expect(router.state.location.pathname).toBe("/home");
  });
});
