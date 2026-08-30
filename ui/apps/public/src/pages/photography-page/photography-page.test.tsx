import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotographyPage } from "./photography-page";
import { PhotographyService } from "@kari/shared/services/photography";

vi.mock("@kari/shared/services/photography", () => ({
  PhotographyService: {
    getListFromS3: vi.fn(),
  },
}));

const post = {
  id: "p1",
  title: "Coast",
  subtitle: "Oregon",
  blurb: "fog over the dunes",
  images: [{ image: "coast.jpg", blurb: "dunes" }],
};

describe("PhotographyPage", () => {
  beforeEach(() => {
    vi.mocked(PhotographyService.getListFromS3).mockResolvedValue([post]);
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the posts after a successful fetch", async () => {
    render(<PhotographyPage />);
    expect(await screen.findByText("Coast")).toBeInTheDocument();
  });

  it("shows an error state instead of a permanent spinner when the fetch fails", async () => {
    vi.mocked(PhotographyService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<PhotographyPage />);
    expect(
      await screen.findByText("Failed to load photography."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(PhotographyService.getListFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<PhotographyPage />);
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("Coast")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load photography."),
    ).not.toBeInTheDocument();
    expect(PhotographyService.getListFromS3).toHaveBeenCalledTimes(2);
  });
});
