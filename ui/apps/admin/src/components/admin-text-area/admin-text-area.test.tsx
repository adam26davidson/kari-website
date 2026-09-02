import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminTextArea } from "./admin-text-area";

describe("AdminTextArea", () => {
  it("shows the current value and placeholder", () => {
    render(
      <AdminTextArea
        value="current text"
        placeholder="Write something"
        onChange={() => {}}
      />,
    );
    const textArea = screen.getByPlaceholderText("Write something");
    expect(textArea).toHaveValue("current text");
  });

  it("reports edits through onChange", () => {
    // capture the value inside the handler: the controlled textarea is
    // reset by the re-render, so the event target mutates afterwards
    const seen: string[] = [];
    const onChange = vi.fn((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      seen.push(e.target.value);
    });
    render(<AdminTextArea value="" placeholder="Blurb" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Blurb"), {
      target: { value: "new text" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(seen).toEqual(["new text"]);
  });
});
