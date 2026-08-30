import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataListItem } from "./data-list-item";

describe("DataListItem", () => {
  it("renders its children with no controls", () => {
    render(
      <DataListItem>
        <span>content</span>
      </DataListItem>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
