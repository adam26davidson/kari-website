import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HaikuPage } from "./haiku-page";
import { HaikuService } from "../../services/haiku";

vi.mock("../../services/haiku", () => ({
  HaikuService: {
    getListFromS3: vi.fn(),
  },
}));

const haiku = {
  id: "h1",
  lines: [
    "an old silent pond",
    "a frog jumps into the pond",
    "splash! silence again",
  ],
  publisher: "kari",
};

describe("HaikuPage", () => {
  beforeEach(() => {
    vi.mocked(HaikuService.getListFromS3).mockResolvedValue([haiku]);
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the haiku after a successful fetch", async () => {
    render(<HaikuPage />);
    expect(await screen.findByText("an old silent pond")).toBeInTheDocument();
  });

  it("shows an error state instead of a permanent spinner when the fetch fails", async () => {
    vi.mocked(HaikuService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<HaikuPage />);
    expect(
      await screen.findByText("Failed to load haiku."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(HaikuService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<HaikuPage />);
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("an old silent pond")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load haiku."),
    ).not.toBeInTheDocument();
    expect(HaikuService.getListFromS3).toHaveBeenCalledTimes(2);
  });
});
