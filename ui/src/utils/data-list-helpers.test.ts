import { describe, it, expect } from "vitest";
import {
  moveItemByIdByOne,
  moveItemByOne,
  removeItemById,
} from "./data-list-helpers";

describe("moveItemByOne", () => {
  it("moves an item up by one", () => {
    expect(moveItemByOne(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
  });

  it("moves an item down by one", () => {
    expect(moveItemByOne(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when moving the first item up", () => {
    expect(moveItemByOne(["a", "b", "c"], 0, "up")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when moving the last item down", () => {
    expect(moveItemByOne(["a", "b", "c"], 2, "down")).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the original array", () => {
    const original = ["a", "b", "c"];
    moveItemByOne(original, 1, "up");
    expect(original).toEqual(["a", "b", "c"]);
  });

  it("moves the last item up correctly", () => {
    expect(moveItemByOne(["a", "b", "c"], 2, "up")).toEqual(["a", "c", "b"]);
  });

  it("moves the first item down correctly", () => {
    expect(moveItemByOne(["a", "b", "c"], 0, "down")).toEqual(["b", "a", "c"]);
  });

  it("works with object elements", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const result = moveItemByOne([a, b], 0, "down");
    expect(result).toEqual([b, a]);
    // preserves references, does not clone
    expect(result[0]).toBe(b);
  });
});

describe("moveItemByIdByOne", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  it("moves the item with the given id up by one", () => {
    expect(moveItemByIdByOne([a, b, c], "b", "up")).toEqual([b, a, c]);
  });

  it("moves the item with the given id down by one", () => {
    expect(moveItemByIdByOne([a, b, c], "b", "down")).toEqual([a, c, b]);
  });

  it("is a no-op for an unknown id", () => {
    expect(moveItemByIdByOne([a, b, c], "zzz", "up")).toEqual([a, b, c]);
  });
});

describe("removeItemById", () => {
  const a = { id: "a" };
  const b = { id: "b" };

  it("removes only the item with the given id", () => {
    expect(removeItemById([a, b], "a")).toEqual([b]);
  });

  it("is a no-op for an unknown id and does not mutate", () => {
    const original = [a, b];
    expect(removeItemById(original, "zzz")).toEqual([a, b]);
    expect(original).toEqual([a, b]);
  });
});
