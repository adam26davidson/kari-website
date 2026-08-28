import { describe, it, expect, vi, beforeEach, MockInstance } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoPicker } from "./photo-picker";

// Spy on the setup.ts object-URL polyfills, handing out a distinct URL per
// call so the tests can assert create/revoke pairing. restoreAllMocks in the
// global afterEach undoes the spies, so fresh ones are made each test.
let urlCounter = 0;
let createObjectURL: MockInstance;
let revokeObjectURL: MockInstance;

beforeEach(() => {
  urlCounter = 0;
  createObjectURL = vi
    .spyOn(window.URL, "createObjectURL")
    .mockImplementation(() => `blob:mock-${++urlCounter}`);
  revokeObjectURL = vi
    .spyOn(window.URL, "revokeObjectURL")
    .mockImplementation(() => {});
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

  it("stays secondary to the editor's Save button", () => {
    render(<PhotoPicker imageFile={null} fileName="" setImageFile={() => {}} />);
    expect(screen.getByRole("button", { name: /Select Image/ })).toHaveClass(
      "secondary",
    );
  });

  it("previews an already-uploaded image from its thumbnail", () => {
    // The preview is 200px wide; downloading the camera original for it is
    // what made the editors laggy (#273).
    render(
      <PhotoPicker
        imageFile={null}
        fileName="cat.png"
        setImageFile={() => {}}
      />
    );
    const preview = screen.getByAltText("Selected");
    expect(preview).toHaveAttribute(
      "src",
      "https://api.test.local/images/cat.png?size=thumb"
    );
    expect(preview).toHaveAttribute("loading", "lazy");
    expect(preview).toHaveAttribute("decoding", "async");
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
