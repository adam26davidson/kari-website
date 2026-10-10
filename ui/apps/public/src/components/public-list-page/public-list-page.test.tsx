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

function renderPage(fetchList: () => Promise<Array<Item>>, draft?: Item) {
  const ui = (draft?: Item) => (
    <PublicListPage
      fetchList={fetchList}
      errorMessage="Failed to load things."
      renderItem={(item) => <span>{item.label}</span>}
      draft={draft}
    />
  );
  const utils = render(ui(draft));
  return { ...utils, rerenderWith: (next?: Item) => utils.rerender(ui(next)) };
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

// The admin's site preview hands the page one unsaved item (#859).
describe("PublicListPage with a preview draft", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A spy on test/setup.ts's no-op, which jsdom needs.
    vi.spyOn(Element.prototype, "scrollIntoView");
  });

  const labels = () =>
    Array.from(document.querySelectorAll(".data-list-item")).map(
      (el) => el.textContent,
    );

  it("shows the draft in place of the deployed item with its id", async () => {
    renderPage(vi.fn().mockResolvedValue(items), {
      id: "b",
      label: "edited middle",
    });

    expect(await screen.findByText("edited middle")).toBeInTheDocument();
    expect(screen.queryByText("middle item")).not.toBeInTheDocument();
    expect(labels()).toEqual(["first item", "edited middle", "last item"]);
  });

  it("puts a draft the deployed list does not have yet at the end", async () => {
    renderPage(vi.fn().mockResolvedValue(items), {
      id: "new",
      label: "brand new",
    });

    await screen.findByText("brand new");
    expect(labels()).toEqual([
      "first item",
      "middle item",
      "last item",
      "brand new",
    ]);
  });

  it("does not scroll anywhere without a draft", async () => {
    renderPage(vi.fn().mockResolvedValue(items));

    await screen.findByText("middle item");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls the draft into view once, not on every keystroke", async () => {
    const { rerenderWith } = renderPage(vi.fn().mockResolvedValue(items), {
      id: "c",
      label: "edited last",
    });

    const draftText = await screen.findByText("edited last");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
    expect(
      vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0],
    ).toBe(draftText.closest(".data-list-item"));

    rerenderWith({ id: "c", label: "edited last, again" });
    expect(await screen.findByText("edited last, again")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("still shows the load error, not the draft, when the fetch fails", async () => {
    renderPage(vi.fn().mockRejectedValue(new Error("network down")), {
      id: "b",
      label: "edited middle",
    });

    expect(
      await screen.findByText("Failed to load things."),
    ).toBeInTheDocument();
    expect(screen.queryByText("edited middle")).not.toBeInTheDocument();
  });
});
