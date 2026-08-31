import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicListPage } from "./public-list-page";

interface Item {
  id: string;
  label: string;
}

const items: Array<Item> = [
  { id: "a", label: "first item" },
  { id: "b", label: "middle item" },
  { id: "c", label: "last item" },
];

function renderPage(fetchList: () => Promise<Array<Item>>) {
  return render(
    <PublicListPage
      fetchList={fetchList}
      errorMessage="Failed to load things."
      renderItem={(item) => <span>{item.label}</span>}
    />,
  );
}

describe("PublicListPage", () => {
  beforeEach(() => {
    // The failure path logs via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the spinner and no list while the fetch is in flight", () => {
    // The fetch never settles, freezing the page in its loading state.
    renderPage(() => new Promise(() => {}));

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(document.querySelector(".data-list")).not.toBeInTheDocument();
  });

  it("renders one list item per entry after a successful fetch", async () => {
    renderPage(vi.fn().mockResolvedValue(items));

    expect(await screen.findByText("first item")).toBeInTheDocument();
    expect(screen.getByText("middle item")).toBeInTheDocument();
    expect(screen.getByText("last item")).toBeInTheDocument();
    expect(document.querySelectorAll(".data-list-item")).toHaveLength(3);
    // Public pages never render the admin item controls.
    expect(document.querySelector(".admin-data-list-item")).toBeNull();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows a retryable error instead of the list when the fetch fails", async () => {
    renderPage(vi.fn().mockRejectedValue(new Error("network down")));

    expect(
      await screen.findByText("Failed to load things."),
    ).toBeInTheDocument();
    // Never show an empty list after a failed load — an outage must not
    // look like a legitimately empty page.
    expect(document.querySelector(".data-list")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("retries the fetch and recovers when Retry is clicked", async () => {
    const fetchList = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(items);

    renderPage(fetchList);
    await userEvent.click(await screen.findByText("Retry"));

    expect(await screen.findByText("first item")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to load things."),
    ).not.toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledTimes(2);
  });
});
