import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import AdminHaigaPage from "./adminHaigaPage";
import { Haiga } from "../../../Models";
import { HaigaService } from "../../../services/haiga";
import { ImageService } from "../../../services/images";

vi.mock("../../../services/haiga", () => ({
  HaigaService: {
    getListFromApi: vi.fn(),
    updateList: vi.fn(),
  },
}));

vi.mock("../../../services/images", () => ({
  ImageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAdminToken", () => ({
  useAdminToken: () => async () => "token",
}));

function iconButton(container: HTMLElement, icon: string): HTMLElement {
  const button = container
    .querySelector(`svg[data-icon="${icon}"]`)
    ?.closest(".admin-icon-button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

// The saved haiga as it exists in the published list before the edit.
let savedHaiga: Haiga;

// Renders the page, opens the only haiga in the editor, and picks a
// replacement image file — the state right before the user hits save.
async function openEditorAndPickImage() {
  const notify = vi.fn();
  const { container } = render(
    <AdminHaigaPage
      setLoading={vi.fn()}
      setConfirmation={vi.fn()}
      notify={notify}
    />,
  );
  await waitFor(() => iconButton(container, "pencil"));
  fireEvent.click(iconButton(container, "pencil"));
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [new File(["img"], "next.png", { type: "image/png" })],
    },
  });
  return { container, notify };
}

describe("AdminHaigaPage image replacement", () => {
  beforeEach(() => {
    savedHaiga = {
      id: "h1",
      lines: [],
      publisher: "kari",
      image: "old.png",
    };
    vi.mocked(HaigaService.getListFromApi).mockResolvedValue([savedHaiga]);
    vi.mocked(HaigaService.updateList).mockResolvedValue(undefined);
    vi.mocked(ImageService.upload).mockResolvedValue("new.png");
    vi.mocked(ImageService.delete).mockResolvedValue(undefined);
    // jsdom does not implement object URLs; PhotoPicker needs one for the
    // preview of the freshly picked file.
    window.URL.createObjectURL = vi.fn(() => "blob:preview");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps the old image when saving the list fails", async () => {
    vi.mocked(HaigaService.updateList).mockRejectedValue(
      new Error("PUT failed"),
    );
    const { container, notify } = await openEditorAndPickImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    // The still-referenced image must never be deleted on a failed save.
    expect(ImageService.delete).not.toHaveBeenCalled();
    // The replacement was uploaded before the list save was attempted.
    expect(ImageService.upload).toHaveBeenCalledOnce();
    expect(
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0],
    );
    // The published list entry is untouched.
    expect(savedHaiga.image).toBe("old.png");
  });

  it("keeps the old image and skips the list save when the upload fails", async () => {
    vi.mocked(ImageService.upload).mockRejectedValue(
      new Error("upload failed"),
    );
    const { container, notify } = await openEditorAndPickImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Failed to save haiga image",
        "error",
      ),
    );
    expect(ImageService.delete).not.toHaveBeenCalled();
    expect(HaigaService.updateList).not.toHaveBeenCalled();
    expect(savedHaiga.image).toBe("old.png");
  });

  it("deletes the old image only after the save succeeds", async () => {
    const { container, notify } = await openEditorAndPickImage();

    fireEvent.click(iconButton(container, "floppy-disk"));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Haiga saved"));
    // Saved list references the new upload.
    expect(HaigaService.updateList).toHaveBeenCalledWith(
      [{ ...savedHaiga, image: "new.png" }],
      expect.any(Function),
    );
    // Old image deleted exactly once, and only after upload + list save.
    await waitFor(() =>
      expect(ImageService.delete).toHaveBeenCalledWith(
        "old.png",
        expect.any(Function),
      ),
    );
    expect(ImageService.delete).toHaveBeenCalledOnce();
    const uploadOrder =
      vi.mocked(ImageService.upload).mock.invocationCallOrder[0];
    const saveOrder =
      vi.mocked(HaigaService.updateList).mock.invocationCallOrder[0];
    const deleteOrder =
      vi.mocked(ImageService.delete).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(saveOrder);
    expect(saveOrder).toBeLessThan(deleteOrder);
    // The list entry itself was replaced, never mutated in place.
    expect(savedHaiga.image).toBe("old.png");
  });
});
