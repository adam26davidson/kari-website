import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAdminList } from "./use-admin-list";
import { mockAdminUi, renderWithAdminUi } from "./admin-ui-test-helpers";

interface Item {
  id: string;
  name: string;
}

const getList = vi.fn<() => Promise<Array<Item>>>();
const updateList = vi.fn<(list: Array<Item>) => Promise<void>>();

vi.mock("../../hooks/use-admin-token", () => ({
  useAdminToken: () => async () => "token",
}));

// A minimal host page: renders the list, a retry control, and save
// buttons covering both toast variants.
function Host() {
  const { list, setList, loadFailed, load, saveList } = useAdminList<Item>({
    noun: "widgets",
    getList,
    updateList,
  });
  if (loadFailed) {
    return <button onClick={() => load()}>retry</button>;
  }
  return (
    <div>
      <ul>
        {list.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <button
        onClick={() => saveList([{ id: "n1", name: "new" }], "Widget saved")}
      >
        save-with-message
      </button>
      <button onClick={() => saveList([{ id: "n2", name: "quiet" }])}>
        save-quietly
      </button>
      <button onClick={() => setList([{ id: "l1", name: "local-only" }])}>
        set-local
      </button>
    </div>
  );
}

beforeEach(() => {
  getList.mockResolvedValue([
    { id: "a", name: "alpha" },
    { id: "b", name: "beta" },
  ]);
  updateList.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useAdminList loading", () => {
  it("loads the list on mount inside the loading overlay", async () => {
    const { adminUi } = renderWithAdminUi(<Host />);

    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(adminUi.showLoading).toHaveBeenNthCalledWith(
      1,
      "Loading widgets...",
    );
    expect(adminUi.hideLoading).toHaveBeenCalled();
  });

  it("flags a failed load instead of exposing an empty list", async () => {
    getList.mockRejectedValueOnce(new Error("GET failed"));
    renderWithAdminUi(<Host />);

    // Never show an empty editable list after a failed load — saving it
    // would overwrite the real data.
    expect(await screen.findByText("retry")).toBeInTheDocument();

    // load() retries and recovers.
    fireEvent.click(screen.getByText("retry"));
    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledTimes(2);
  });
});

describe("useAdminList saving", () => {
  it("persists the new list and toasts the given success message", async () => {
    const { adminUi } = renderWithAdminUi(<Host />);
    await screen.findByText("alpha");

    await act(async () => {
      fireEvent.click(screen.getByText("save-with-message"));
    });

    expect(updateList).toHaveBeenCalledWith(
      [{ id: "n1", name: "new" }],
      expect.any(Function),
    );
    expect(adminUi.showLoading).toHaveBeenLastCalledWith(
      "Updating widgets...",
    );
    expect(adminUi.notify).toHaveBeenCalledWith("Widget saved");
    // The saved list became the local list.
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("stays silent on success when no message is given", async () => {
    const { adminUi } = renderWithAdminUi(<Host />);
    await screen.findByText("alpha");

    await act(async () => {
      fireEvent.click(screen.getByText("save-quietly"));
    });

    expect(updateList).toHaveBeenCalledOnce();
    expect(adminUi.notify).not.toHaveBeenCalled();
    expect(screen.getByText("quiet")).toBeInTheDocument();
  });

  it("toasts the standard error and keeps the old list when saving fails", async () => {
    updateList.mockRejectedValueOnce(new Error("PUT failed"));
    const { adminUi } = renderWithAdminUi(<Host />);
    await screen.findByText("alpha");

    await act(async () => {
      fireEvent.click(screen.getByText("save-with-message"));
    });

    await waitFor(() =>
      expect(adminUi.notify).toHaveBeenCalledWith(
        "Failed to save — your change was not saved",
        "error",
      ),
    );
    expect(adminUi.notify).not.toHaveBeenCalledWith("Widget saved");
    // The local list is untouched by the failed save.
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("new")).toBeNull();
    expect(adminUi.hideLoading).toHaveBeenCalled();
  });

  it("lets rollback paths replace the list without persisting", async () => {
    renderWithAdminUi(<Host />);
    await screen.findByText("alpha");

    await act(async () => {
      fireEvent.click(screen.getByText("set-local"));
    });

    expect(screen.getByText("local-only")).toBeInTheDocument();
    expect(updateList).not.toHaveBeenCalled();
  });
});

describe("useAdminList outside the provider", () => {
  it("throws like any other context consumer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Host />)).toThrow(
      "useAdminUi must be used inside an AdminUiProvider",
    );
  });
});

// Keeps the helper's default-mock path (mockAdminUi) under test even
// though the page tests all pass their own mocks implicitly.
describe("mockAdminUi", () => {
  it("starts with isLoading false", () => {
    expect(mockAdminUi().isLoading).toBe(false);
  });
});
