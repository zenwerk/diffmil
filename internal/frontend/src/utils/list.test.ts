import { describe, it, expect } from "vitest";
import { findById } from "./list";

describe("findById", () => {
  const items = [
    { id: "a", label: "Apple" },
    { id: "b", label: "Banana" },
  ];

  it("finds an existing item", () => {
    expect(findById(items, "b")).toEqual({ id: "b", label: "Banana" });
  });

  it("returns undefined when missing", () => {
    expect(findById(items, "z")).toBeUndefined();
  });
});
