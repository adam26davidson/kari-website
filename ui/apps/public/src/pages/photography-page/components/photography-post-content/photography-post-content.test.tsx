import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhotographyPost } from "@kari/shared/models";
import { PhotographyPostOverride } from "@kari/shared/utils/preview-channel";
import { PhotographyPostContent } from "./photography-post-content";

// Every <img> by tag: one with an empty caption has alt="" and so is
// presentational, invisible to getAllByRole("img").
const imageSrcs = () =>
  Array.from(document.querySelectorAll("img")).map((img) =>
    img.getAttribute("src"),
  );

const post: PhotographyPost = {
  id: "p1",
  title: "Coast",
  subtitle: "Oregon",
  blurb: "fog over the dunes",
  images: [
    { image: "dunes.jpg", blurb: "dunes" },
    { image: "gull.jpg", blurb: "" },
  ],
};

describe("PhotographyPostContent", () => {
  it("renders the title, subtitle, blurb and each stored image", () => {
    render(<PhotographyPostContent post={post} />);

    expect(screen.getByText("Coast")).toBeInTheDocument();
    expect(screen.getByText("Oregon")).toBeInTheDocument();
    expect(screen.getByText("fog over the dunes")).toBeInTheDocument();
    expect(imageSrcs()).toEqual([
      expect.stringMatching(/\/images\/dunes\.jpg\/original\.jpg$/),
      expect.stringMatching(/\/images\/gull\.jpg\/original\.jpg$/),
    ]);
  });

  it("hides an empty blurb and an empty caption", () => {
    const { container } = render(
      <PhotographyPostContent post={{ ...post, blurb: "" }} />,
    );

    expect(container.querySelector(".photography-post-blurb")).toBeNull();
    expect(
      container.querySelectorAll(".photography-post-image-caption"),
    ).toHaveLength(1);
  });

  // The admin's site preview (#859): rows can carry a picked, unsaved File.
  describe("with a preview draft", () => {
    const picked = new File(["px"], "new.png", { type: "image/png" });
    const draft: PhotographyPostOverride = {
      ...post,
      images: [
        { image: "dunes.jpg", blurb: "dunes", file: null },
        { image: "", blurb: "a new one", file: picked },
        { image: "", blurb: "not picked yet", file: null },
      ],
    };

    it("renders a picked photo from its object URL and stored ones from S3", () => {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picked");

      render(<PhotographyPostContent post={draft} />);

      expect(imageSrcs()).toEqual([
        expect.stringMatching(/\/images\/dunes\.jpg\/original\.jpg$/),
        "blob:picked",
      ]);
      expect(URL.createObjectURL).toHaveBeenCalledWith(picked);
    });

    // A row she has added but not chosen a photo for: the caption shows,
    // and there is no broken image beside it.
    it("renders the caption but no image for a row with no photo yet", () => {
      render(<PhotographyPostContent post={draft} />);

      expect(screen.getByText("not picked yet")).toBeInTheDocument();
      expect(imageSrcs()).toHaveLength(2);
    });
  });
});
