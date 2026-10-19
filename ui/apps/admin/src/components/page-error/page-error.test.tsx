import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageError } from "./page-error";

describe("PageError", () => {
  it("explains an ordinary failure and offers Reload", () => {
    const { container } = render(<PageError error={new Error("x")} />);

    expect(
      screen.getByText("Something went wrong showing this page."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing on the site has changed — reload the page to carry on.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-slot", "card");
    // The shared `.error-boundary` rule is unlayered and would outrank the
    // Card's utilities — the fallback must never carry that class.
    expect(container.querySelector(".error-boundary")).toBeNull();
  });

  it("says the site may have changed for a chunk-load failure", () => {
    render(
      <PageError
        error={
          new TypeError(
            "Failed to fetch dynamically imported module: https://x/a.js",
          )
        }
      />,
    );

    expect(
      screen.getByText(
        "The site may have been updated since this page was opened.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Reload to pick up the latest version — nothing on the site has " +
          "changed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong showing this page."),
    ).not.toBeInTheDocument();
  });

  it("reloads the page from Reload", async () => {
    const reload = vi.fn();
    // jsdom marks location.reload non-configurable; stub the getter.
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location);

    render(<PageError error={new Error("x")} />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(reload).toHaveBeenCalledOnce();
  });
});
