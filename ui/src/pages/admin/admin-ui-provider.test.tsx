import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAdminUi } from "./admin-ui-context";
import { AdminUiProvider } from "./admin-ui-provider";

// A consumer exposing every context function as a button, so the tests
// drive the provider exactly the way the admin pages do.
function Consumer() {
  const { isLoading, showLoading, hideLoading, confirm, notify } =
    useAdminUi();
  return (
    <div>
      <div>isLoading: {String(isLoading)}</div>
      <button onClick={() => showLoading("Working...")}>show-loading</button>
      <button onClick={() => hideLoading()}>hide-loading</button>
      <button onClick={() => confirm("Really do it?", () => notify("done"))}>
        ask
      </button>
      <button
        onClick={() =>
          confirm(
            "Discard changes?",
            () => notify("discarded"),
            () => notify("kept"),
          )
        }
      >
        ask-with-no
      </button>
      <button onClick={() => notify("saved")}>notify-success</button>
      <button onClick={() => notify("broke", "error")}>notify-error</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AdminUiProvider>
      <Consumer />
    </AdminUiProvider>,
  );
}

describe("AdminUiProvider loading overlay", () => {
  it("shows the message while loading and hides it after", () => {
    renderProvider();
    expect(screen.getByText("isLoading: false")).toBeInTheDocument();

    fireEvent.click(screen.getByText("show-loading"));
    expect(screen.getByText("Working...")).toBeInTheDocument();
    expect(screen.getByText("isLoading: true")).toBeInTheDocument();

    fireEvent.click(screen.getByText("hide-loading"));
    expect(screen.queryByText("Working...")).toBeNull();
    expect(screen.getByText("isLoading: false")).toBeInTheDocument();
  });
});

describe("AdminUiProvider confirmation dialog", () => {
  it("runs onYes and closes on Yes", () => {
    renderProvider();
    fireEvent.click(screen.getByText("ask"));
    expect(screen.getByText("Really do it?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    // The dialog closed and the onYes callback ran (it toasts "done").
    expect(screen.queryByText("Really do it?")).toBeNull();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("closes without running onYes on No", () => {
    renderProvider();
    fireEvent.click(screen.getByText("ask"));

    fireEvent.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByText("Really do it?")).toBeNull();
    // onYes never ran, so no toast appeared.
    expect(screen.queryByText("done")).toBeNull();
  });

  it("runs onNo (when given) and closes on No", () => {
    renderProvider();
    fireEvent.click(screen.getByText("ask-with-no"));

    fireEvent.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.queryByText("discarded")).toBeNull();
  });

  it("does not run onNo on Yes", () => {
    renderProvider();
    fireEvent.click(screen.getByText("ask-with-no"));

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(screen.getByText("discarded")).toBeInTheDocument();
    expect(screen.queryByText("kept")).toBeNull();
  });
});

describe("AdminUiProvider toast", () => {
  it("shows a success toast that disappears after 3 seconds", () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      fireEvent.click(screen.getByText("notify-success"));

      const toast = screen.getByText("saved");
      expect(toast).toHaveClass("admin-toast-success");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.queryByText("saved")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks error toasts with the error class", () => {
    renderProvider();
    fireEvent.click(screen.getByText("notify-error"));
    expect(screen.getByText("broke")).toHaveClass("admin-toast-error");
  });

  it("resets the dismiss timer when a new toast replaces the old", () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      fireEvent.click(screen.getByText("notify-success"));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.click(screen.getByText("notify-error"));

      // 2s after the replacement the new toast is still up (its own 3s
      // window), then it goes away.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText("broke")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("broke")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useAdminUi", () => {
  it("throws outside an AdminUiProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useAdminUi must be used inside an AdminUiProvider",
    );
  });
});
