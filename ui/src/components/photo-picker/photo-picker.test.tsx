import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoPicker } from "./photo-picker";

// jsdom does not implement object URLs, so provide mocks that hand out a
// distinct URL per call, letting the tests assert create/revoke pairing.
let urlCounter = 0;
const createObjectURL = vi.fn(() => `blob:mock-${++urlCounter}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  urlCounter = 0;
  window.URL.createObjectURL = createObjectURL;
  window.URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

const makeFile = (name: string) =>
  new File(["image-bytes"], name, { type: "image/png" });

describe("PhotoPicker", () => {
  it("shows no preview when there is no file and no fileName", () => {
    render(
      <PhotoPicker imageFile={null} fileName="" setImageFile={() => {}} />
    );
    expect(screen.queryByAltText("Selected")).not.toBeInTheDocument();
    expect(screen.getByText("Select Image")).toBeInTheDocument();
  });

  it("previews an already-uploaded image from the API by fileName", () => {
    render(
      <PhotoPicker
        imageFile={null}
        fileName="cat.png"
        setImageFile={() => {}}
      />
    );
    expect(screen.getByAltText("Selected")).toHaveAttribute(
      "src",
      "https://api.test.local/images/cat.png"
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("creates the object URL once per file, not once per render", () => {
    const file = makeFile("new.png");
    const { rerender } = render(
      <PhotoPicker imageFile={file} fileName="" setImageFile={() => {}} />
    );

    expect(screen.getByAltText("Selected")).toHaveAttribute(
      "src",
      "blob:mock-1"
    );

    rerender(
      <PhotoPicker imageFile={file} fileName="" setImageFile={() => {}} />
    );
    rerender(
      <PhotoPicker imageFile={file} fileName="" setImageFile={() => {}} />
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.getByAltText("Selected")).toHaveAttribute(
      "src",
      "blob:mock-1"
    );
  });

  it("revokes the old URL and creates a new one when the file changes", () => {
    const { rerender } = render(
      <PhotoPicker
        imageFile={makeFile("a.png")}
        fileName=""
        setImageFile={() => {}}
      />
    );

    rerender(
      <PhotoPicker
        imageFile={makeFile("b.png")}
        fileName=""
        setImageFile={() => {}}
      />
    );

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText("Selected")).toHaveAttribute(
      "src",
      "blob:mock-2"
    );
  });

  it("revokes the URL when the file is cleared", () => {
    const { rerender } = render(
      <PhotoPicker
        imageFile={makeFile("a.png")}
        fileName=""
        setImageFile={() => {}}
      />
    );

    rerender(
      <PhotoPicker imageFile={null} fileName="" setImageFile={() => {}} />
    );

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(screen.queryByAltText("Selected")).not.toBeInTheDocument();
  });

  it("revokes the URL on unmount", () => {
    const { unmount } = render(
      <PhotoPicker
        imageFile={makeFile("a.png")}
        fileName=""
        setImageFile={() => {}}
      />
    );

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("passes the chosen file to setImageFile", async () => {
    const setImageFile = vi.fn();
    render(
      <PhotoPicker imageFile={null} fileName="" setImageFile={setImageFile} />
    );

    const file = makeFile("chosen.png");
    const input = document.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(setImageFile).toHaveBeenCalledWith(file);
  });
});
