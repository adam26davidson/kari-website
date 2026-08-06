import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomePageEditor } from "./homePageEditor";
import { ImageService } from "../../../services/images";

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

const fetchMock = vi.fn();

function putCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
  );
}

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

describe("HomePageEditor photo replacement", () => {
  let putResponse: { ok: boolean; status: number };

  beforeEach(() => {
    putResponse = { ok: true, status: 200 };
    fetchMock.mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return putResponse;
      }
      return {
        ok: true,
        json: async () => ({ photo: "old.png", blurb: "hello" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(ImageService.upload).mockResolvedValue("new.png");
    vi.mocked(ImageService.delete).mockResolvedValue(undefined);
    // jsdom does not implement object URLs; PhotoPicker needs one for the
    // preview of the freshly picked file.
    window.URL.createObjectURL = vi.fn(() => "blob:preview");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps the old photo when saving the JSON fails", async () => {
    putResponse = { ok: false, status: 500 };
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
    // The upload happened first and the attempted JSON referenced it.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    const [[, init]] = putCalls();
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      photo: "new.png",
      blurb: "hello",
    });
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
    expect(putCalls()).toHaveLength(0);
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
    // upload -> PUT -> delete, strictly in that order.
    const uploadOrder =
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0];
    const putIndex = fetchMock.mock.calls.findIndex(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    const putOrder = fetchMock.mock.invocationCallOrder[putIndex];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(putOrder);
    expect(putOrder).toBeLessThan(deleteOrder);
  });
});
