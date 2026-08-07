import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentPage } from "./content-page";

describe("ContentPage", () => {
  it("renders the spinner instead of children while loading", () => {
    render(
      <ContentPage isLoading={true}>
        <div>page content</div>
      </ContentPage>,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
  });

  it("renders children without the spinner when not loading", () => {
    render(
      <ContentPage isLoading={false}>
        <div>page content</div>
      </ContentPage>,
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("defaults isLoading to false", () => {
    render(
      <ContentPage>
        <div>page content</div>
      </ContentPage>,
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
});
