import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./homePage";

const homePageData = {
  photo: "kari.jpg",
  blurb: "Welcome to the site",
};

function mockFetchOnceWith(response: Partial<Response>) {
  vi.mocked(fetch).mockResolvedValueOnce(response as Response);
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the blurb after a successful fetch", async () => {
    mockFetchOnceWith({
      ok: true,
      json: async () => homePageData,
    });

    render(<Home />);
    expect(
      await screen.findByText("Welcome to the site"),
    ).toBeInTheDocument();
  });

  it("shows an error state instead of the spinner on a non-ok response", async () => {
    mockFetchOnceWith({ ok: false, status: 500 });

    render(<Home />);
    expect(
      await screen.findByText("Failed to load home page."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows an error state when the fetch itself rejects", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    render(<Home />);
    expect(
      await screen.findByText("Failed to load home page."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    mockFetchOnceWith({ ok: false, status: 500 });
    mockFetchOnceWith({
      ok: true,
      json: async () => homePageData,
    });

    render(<Home />);
    await userEvent.click(await screen.findByText("Retry"));

    expect(
      await screen.findByText("Welcome to the site"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load home page."),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
