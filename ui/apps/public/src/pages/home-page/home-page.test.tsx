import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "./home-page";
import { HomePageService } from "@kari/shared/services/home-page";
import { HomePageOverride } from "@kari/shared/utils/preview-channel";
import { PreviewOverridesContext } from "../../preview/preview-overrides-context";

vi.mock("@kari/shared/services/home-page", () => ({
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
    expect(img?.src).toMatch(/\/images\/kari\.jpg\/original\.jpg$/);
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

/**
 * Inside the admin's preview pane the page is handed the editor's unsaved
 * state through context (#239) and must render THAT, not what is deployed.
 */
describe("Home inside the admin's preview pane", () => {
  const renderWithDraft = (homePage: HomePageOverride) =>
    render(
      <PreviewOverridesContext.Provider value={{ homePage }}>
        <Home />
      </PreviewOverridesContext.Provider>,
    );

  beforeEach(() => {
    vi.mocked(HomePageService.getFromS3).mockResolvedValue(homePageData);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the draft blurb rather than the deployed one", async () => {
    renderWithDraft({ photo: "kari.jpg", blurb: "Unsaved words", photoFile: null });

    expect(await screen.findByText("Unsaved words")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to the site")).not.toBeInTheDocument();
  });

  it("renders a picked-but-unsaved photo from its blob URL", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:candidate");

    renderWithDraft({
      photo: "kari.jpg",
      blurb: "Unsaved words",
      photoFile: new File(["pixels"], "new.png"),
    });

    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:candidate");
  });

  it("falls back to the stored photo when none has been picked", () => {
    renderWithDraft({ photo: "kari.jpg", blurb: "Just new words", photoFile: null });

    const img = document.querySelector("img");
    expect(img?.src).toMatch(/\/images\/kari\.jpg\/original\.jpg$/);
  });

  it("renders no image when the draft has neither a photo nor a file", () => {
    renderWithDraft({ photo: "", blurb: "Words only", photoFile: null });

    expect(screen.getByText("Words only")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("shows the draft immediately, without waiting for the S3 read", () => {
    // The draft IS the whole page, so a pending load must not hide it.
    vi.mocked(HomePageService.getFromS3).mockReturnValueOnce(
      new Promise(() => {}),
    );

    renderWithDraft({ photo: "", blurb: "Words only", photoFile: null });

    expect(screen.getByText("Words only")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows the draft rather than an error when the S3 read fails", async () => {
    vi.mocked(HomePageService.getFromS3).mockRejectedValueOnce(
      new Error("network down"),
    );

    renderWithDraft({ photo: "", blurb: "Words only", photoFile: null });

    expect(await screen.findByText("Words only")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load home page."),
    ).not.toBeInTheDocument();
  });
});
