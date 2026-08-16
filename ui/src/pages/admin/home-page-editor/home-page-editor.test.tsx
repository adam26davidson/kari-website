import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePageEditor } from "./home-page-editor";
import { ImageService } from "../../../services/images";
import { HomePageService } from "../../../services/home-page";
import {
  answerNo,
  answerYes,
  renderAdminPage,
} from "../admin-ui-test-helpers";

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../services/home-page", () => ({
  HomePageService: {
    getFromApi: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// The editor mounts at /admin/home; the hook behind the unsaved-changes
// guard needs a data router, and the /admin/:section pattern also matches
// /admin/haiku, giving the guard tests somewhere to navigate to.
function renderPage() {
  return renderAdminPage(<HomePageEditor />, "/admin/:section", "/admin/home");
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
  vi.mocked(ImageService.delete).mockResolvedValue(undefined);
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
    expect(screen.queryByPlaceholderText("Blurb")).not.toBeInTheDocument();
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
    // The still-referenced photo must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
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
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(HomePageService.update).not.toHaveBeenCalled();
  });

  it("deletes the old photo only after the save succeeds", async () => {
    const { notify } = await renderAndPickImage();

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Home page saved"));
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    // upload -> save -> delete, strictly in that order.
    const uploadOrder =
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0];
    const saveOrder =
      vi.mocked(HomePageService.update).mock.invocationCallOrder[0];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(deleteOrder);
  });
});

describe("HomePageEditor unsaved-changes guard", () => {
  it("navigates away without confirmation while clean", async () => {
    const { adminUi, router } = renderPage();
    await screen.findByDisplayValue("hello");

    await act(async () => {
      router.navigate("/admin/haiku");
    });

    expect(router.state.location.pathname).toBe("/admin/haiku");
    expect(adminUi.confirm).not.toHaveBeenCalled();
  });

  it("asks before discarding an edited blurb and stays on No", async () => {
    const { adminUi, router } = renderPage();
    const textarea = await screen.findByDisplayValue("hello");
    fireEvent.change(textarea, { target: { value: "changed blurb" } });

    await act(async () => {
      router.navigate("/admin/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/admin/home");
    expect(screen.getByDisplayValue("changed blurb")).toBeInTheDocument();
  });

  it("asks before discarding a freshly picked photo and leaves on Yes", async () => {
    const { adminUi, router } = await renderAndPickImage();

    await act(async () => {
      router.navigate("/admin/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerYes(adminUi);
    expect(router.state.location.pathname).toBe("/admin/haiku");
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
      router.navigate("/admin/haiku");
    });

    expect(router.state.location.pathname).toBe("/admin/haiku");
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
      router.navigate("/admin/haiku");
    });

    expect(adminUi.confirm).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.any(Function),
      expect.any(Function),
    );
    await answerNo(adminUi);
    expect(router.state.location.pathname).toBe("/admin/home");
  });
});
