import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "./home-page";
import { HomePageService } from "../../services/home-page";

vi.mock("../../services/home-page", () => ({
  HomePageService: {
    getFromS3: vi.fn(),
  },
}));

const homePageData = {
  photo: "kari.jpg",
  blurb: "Welcome to the site",
};

describe("Home", () => {
  beforeEach(() => {
    vi.mocked(HomePageService.getFromS3).mockResolvedValue(homePageData);
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the loading state on first paint, with no content or image", () => {
    // The load never settles, freezing the component in its initial state.
    vi.mocked(HomePageService.getFromS3).mockReturnValueOnce(
      new Promise(() => {}),
    );

    render(<Home />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("never renders an image with an empty filename", async () => {
    vi.mocked(HomePageService.getFromS3).mockResolvedValueOnce({
      photo: "",
      blurb: "No photo yet",
    });

    render(<Home />);
    expect(await screen.findByText("No photo yet")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders the photo from the images path after a successful fetch", async () => {
    render(<Home />);
    await screen.findByText("Welcome to the site");
    const img = document.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img?.src).toMatch(/\/images\/kari\.jpg$/);
  });

  it("renders the blurb after a successful fetch", async () => {
    render(<Home />);
    expect(
      await screen.findByText("Welcome to the site"),
    ).toBeInTheDocument();
  });

  it("shows an error state instead of the spinner when the load fails", async () => {
    vi.mocked(HomePageService.getFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<Home />);
    expect(
      await screen.findByText("Failed to load home page."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    vi.mocked(HomePageService.getFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<Home />);
    await userEvent.click(await screen.findByText("Retry"));

    expect(
      await screen.findByText("Welcome to the site"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load home page."),
    ).not.toBeInTheDocument();
    expect(HomePageService.getFromS3).toHaveBeenCalledTimes(2);
  });
});
