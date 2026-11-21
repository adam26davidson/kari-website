import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { renderAdminPage } from "./admin-ui-test-helpers";

beforeEach(() => {
  // React logs "Maximum update depth exceeded" and the router's error
  // boundary logs the guard's throw; page tests silence the same way.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Sets fresh state from an effect on every render: a render loop. */
function LoopingPage() {
  const [, setState] = useState({});
  // The infinite update chain the rule warns about is this fixture's job.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setState({});
  });
  return <p>looping</p>;
}

/** Re-renders once per click, however often she clicks. */
function CountingPage() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      clicked {count}
    </button>
  );
}

describe("renderAdminPage render-loop guard", () => {
  it("fails a page that loops with a named error instead of hanging", () => {
    expect(() => renderAdminPage(<LoopingPage />, "/loop/:id?")).toThrow(
      /Render loop: the page committed \d+ times/,
    );
    // The guard's throw unmounted the page, which is what ended the loop.
    expect(screen.queryByText("looping")).not.toBeInTheDocument();
  });

  it("lets a page re-render as often as she acts, across event-loop turns", async () => {
    renderAdminPage(<CountingPage />, "/count/:id?");

    for (let i = 0; i < 250; i++) {
      await act(async () => {
        screen.getByRole("button").click();
        await new Promise((resolve) => setTimeout(resolve));
      });
    }

    expect(screen.getByRole("button")).toHaveTextContent("clicked 250");
  });
});
