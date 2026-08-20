import { describe, it, expect } from "vitest";
import { moveItemByIdByOne, removeItemById } from "./data-list-helpers";

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

  it("is a no-op when moving the first item up", () => {
    expect(moveItemByIdByOne([a, b, c], "a", "up")).toEqual([a, b, c]);
  });

  it("is a no-op when moving the last item down", () => {
    expect(moveItemByIdByOne([a, b, c], "c", "down")).toEqual([a, b, c]);
  });

  it("moves the last item up correctly", () => {
    expect(moveItemByIdByOne([a, b, c], "c", "up")).toEqual([a, c, b]);
  });

  it("moves the first item down correctly", () => {
    expect(moveItemByIdByOne([a, b, c], "a", "down")).toEqual([b, a, c]);
  });

  it("does not mutate the original array", () => {
    const original = [a, b, c];
    moveItemByIdByOne(original, "b", "up");
    expect(original).toEqual([a, b, c]);
  });

  it("preserves element references rather than cloning", () => {
    const result = moveItemByIdByOne([a, b], "a", "down");
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
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
