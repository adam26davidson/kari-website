import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePageEditor } from "./homePageEditor";
import { ImageService } from "../../../services/images";
import { HomePageService } from "../../../services/home-page";

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

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

// Renders the editor and picks a replacement photo — the state right
// before the user hits save.
async function renderAndPickImage() {
  const notify = vi.fn();
  const { container } = render(
    <HomePageEditor setLoading={vi.fn()} isLoading={false} notify={notify} />,
  );
  await screen.findByDisplayValue("hello");
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { notify };
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

    render(
      <HomePageEditor setLoading={vi.fn()} isLoading={false} notify={vi.fn()} />,
    );

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

    render(
      <HomePageEditor setLoading={vi.fn()} isLoading={false} notify={vi.fn()} />,
    );
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
