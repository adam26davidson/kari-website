import { describe, it, expect } from "vitest";
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

  it("omits the lines from the compact (admin list) view too", () => {
    render(<HaigaContent haiga={haiga} compact />);
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
    render(<HaigaContent haiga={{ ...haiga, lines: [] }} compact />);
    expect(screen.getByAltText("haiga")).toBeInTheDocument();
  });
});
