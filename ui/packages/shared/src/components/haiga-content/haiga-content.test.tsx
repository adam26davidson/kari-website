import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HaigaContent } from "./haiga-content";
import { Haiga } from "../../models";

const haiga: Haiga = {
  id: "g1",
  lines: ["winter moon", "a bridge without a railing", "over the gorge"],
  image: "moon.jpg",
  publisher: "kari",
};

describe("HaigaContent", () => {
  it("never renders the haiku lines as text — they live in the image", () => {
    render(<HaigaContent haiga={haiga} />);
    for (const line of haiga.lines) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
    expect(screen.getByText("kari")).toBeInTheDocument();
  });

  it("uses the lines as image alt text when an older haiga has them", () => {
    render(<HaigaContent haiga={haiga} />);
    expect(
      screen.getByAltText(
        "winter moon, a bridge without a railing, over the gorge",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to a generic alt text when there are no lines", () => {
    render(<HaigaContent haiga={{ ...haiga, lines: [] }} />);
    expect(screen.getByAltText("haiga")).toBeInTheDocument();
  });

  it("renders the stored image from the images path", () => {
    render(<HaigaContent haiga={haiga} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringMatching(/\/images\/moon\.jpg\/original\.jpg$/),
    );
  });

  // The admin's site preview (#859): a picture she has picked, not saved.
  it("renders a picked but unsaved picture from its object URL", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picked");
    const imageFile = new File(["px"], "new.png", { type: "image/png" });

    render(<HaigaContent haiga={{ ...haiga, imageFile }} />);

    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:picked");
    expect(URL.createObjectURL).toHaveBeenCalledWith(imageFile);
  });

  it("falls back to the stored image when the draft has no picked file", () => {
    render(<HaigaContent haiga={{ ...haiga, imageFile: null }} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringMatching(/\/images\/moon\.jpg\/original\.jpg$/),
    );
  });

  // A just-added haiga has no image yet; a broken-image icon in the
  // preview would be the page lying about what a visitor sees.
  it("renders no image at all when there is neither a file nor a stored one", () => {
    render(<HaigaContent haiga={{ ...haiga, image: "", imageFile: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("kari")).toBeInTheDocument();
  });
});
