import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HaigaPage } from "./haigaPage";
import { HaigaService } from "../../services/haiga";

vi.mock("../../services/haiga", () => ({
  HaigaService: {
    getListFromS3: vi.fn(),
  },
}));

const haiga = {
  id: "g1",
  lines: ["winter moon", "a bridge without a railing", "over the gorge"],
  publisher: "kari haiga",
  image: "moon.jpg",
};

describe("HaigaPage", () => {
  beforeEach(() => {
    vi.mocked(HaigaService.getListFromS3).mockResolvedValue([haiga]);
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the haiga after a successful fetch", async () => {
    render(<HaigaPage />);
    expect(await screen.findByText("kari haiga")).toBeInTheDocument();
  });

  it("shows an error state instead of a permanent spinner when the fetch fails", async () => {
    vi.mocked(HaigaService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<HaigaPage />);
    expect(
      await screen.findByText("Failed to load haiga."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(HaigaService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<HaigaPage />);
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("kari haiga")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load haiga."),
    ).not.toBeInTheDocument();
    expect(HaigaService.getListFromS3).toHaveBeenCalledTimes(2);
  });
});
