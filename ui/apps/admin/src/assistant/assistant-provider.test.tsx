import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AssistantProvider } from "./assistant-provider";
import { useAssistantContext } from "./assistant-context";
import { useAssistantSubject } from "./use-assistant-subject";

/** Shows whatever the provider currently believes is on screen. */
function Readout() {
  const context = useAssistantContext();
  return <div data-testid="subject">{JSON.stringify(context?.subject)}</div>;
}

/** A page that tells the helper what it has open. */
function Page({ title, dirty }: { title: string; dirty?: boolean }) {
  useAssistantSubject({ what: "haiku", id: "h1", title, dirty });
  return <p>editing {title}</p>;
}

describe("AssistantProvider", () => {
  it("starts with nothing on screen", () => {
    render(
      <AssistantProvider>
        <Readout />
      </AssistantProvider>,
    );
    expect(screen.getByTestId("subject")).toHaveTextContent("{}");
  });

  it("reflects what the open page publishes", () => {
    render(
      <AssistantProvider>
        <Page title="Autumn rain" dirty />
        <Readout />
      </AssistantProvider>,
    );

    // This is what travels with her next message, so the helper's guidance
    // matches the screen she is looking at.
    expect(JSON.parse(screen.getByTestId("subject").textContent!)).toEqual({
      what: "haiku",
      id: "h1",
      title: "Autumn rain",
      dirty: true,
    });
  });

  it("follows the page as what it shows changes", () => {
    const { rerender } = render(
      <AssistantProvider>
        <Page title="Autumn rain" />
        <Readout />
      </AssistantProvider>,
    );
    rerender(
      <AssistantProvider>
        <Page title="Winter moon" />
        <Readout />
      </AssistantProvider>,
    );
    expect(screen.getByTestId("subject")).toHaveTextContent("Winter moon");
  });

  it("clears what it shows when the page goes away", async () => {
    function Shell() {
      const [open, setOpen] = useState(true);
      return (
        <AssistantProvider>
          {open && <Page title="Autumn rain" />}
          <button onClick={() => setOpen(false)}>close</button>
          <Readout />
        </AssistantProvider>
      );
    }
    render(<Shell />);
    expect(screen.getByTestId("subject")).toHaveTextContent("Autumn rain");

    await userEvent.click(screen.getByRole("button", { name: "close" }));

    // Nothing of the old page's is on screen any more, and the helper must
    // not keep describing it.
    expect(screen.getByTestId("subject")).toHaveTextContent("{}");
  });
});

describe("useAssistantSubject", () => {
  it("does nothing without a provider", () => {
    // Most page tests render without the helper above them; publishing has
    // to be harmless there rather than throwing.
    expect(() => render(<Page title="Autumn rain" />)).not.toThrow();
    expect(screen.getByText("editing Autumn rain")).toBeInTheDocument();
  });
});
