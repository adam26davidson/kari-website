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

  // jsdom does no layout, so the boxes are stubbed: the scroller shows
  // y 0-500, and the draft's row sits wherever `draftTop` says.
  function stubLayout(draftTop: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("scroller")) {
          return { top: 0, bottom: 500 } as DOMRect;
        }
        return { top: draftTop, bottom: draftTop + 100 } as DOMRect;
      },
    );
  }

  function renderInScroller(draft?: Item) {
    const ui = (next?: Item) => (
      <div className="scroller" style={{ overflowY: "auto" }}>
        <PublicListPage
          fetchList={fetchItems}
          errorMessage="Failed to load things."
          renderItem={(item) => <span>{item.label}</span>}
          draft={next}
        />
      </div>
    );
    const utils = render(ui(draft));
    const scroller = utils.container.querySelector(
      ".scroller",
    ) as HTMLElement;
    scroller.scrollTop = 40;
    return {
      ...utils,
      scroller,
      rerenderWith: (next?: Item) => utils.rerender(ui(next)),
    };
  }

  // A stable fetcher, as the real pages pass: useS3Load keys on it.
  const fetchItems = () => Promise.resolve(items);

  it("scrolls its scroller to a draft below the fold, once per draft", async () => {
    stubLayout(900);
    // Set before the list loads, as the frame's scroller would be.
    const { scroller, rerenderWith } = renderInScroller({
      id: "c",
      label: "edited last",
    });

    await screen.findByText("edited last");
    expect(scroller.scrollTop).toBe(940);

    // Typing changes the draft but not its id: no jump back to it.
    scroller.scrollTop = 0;
    rerenderWith({ id: "c", label: "edited last, again" });
    expect(await screen.findByText("edited last, again")).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(0);
  });

  it("scrolls back up to a draft above the view", async () => {
    stubLayout(-300);
    const { scroller } = renderInScroller({ id: "a", label: "edited first" });

    await screen.findByText("edited first");
    expect(scroller.scrollTop).toBe(-260);
  });

  it("leaves the page where it is when the draft is already in view", async () => {
    stubLayout(100);
    const { scroller } = renderInScroller({ id: "b", label: "edited middle" });

    await screen.findByText("edited middle");
    expect(scroller.scrollTop).toBe(40);
  });

  it("does not scroll without a draft", async () => {
    stubLayout(900);
    const { scroller } = renderInScroller();

    await screen.findByText("last item");
    expect(scroller.scrollTop).toBe(40);
  });

  it("does nothing when nothing around the list scrolls", async () => {
    stubLayout(900);
    renderPage(vi.fn().mockResolvedValue(items), {
      id: "c",
      label: "edited last",
    });

    expect(await screen.findByText("edited last")).toBeInTheDocument();
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
