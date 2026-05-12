import { describe, it, expect } from "vitest";
import { basename } from "./path";

describe("basename", () => {
  it("returns the last path segment", () => {
    expect(basename("/foo/bar/baz.ts")).toBe("baz.ts");
  });

  it("returns the input when no slash", () => {
    expect(basename("baz.ts")).toBe("baz.ts");
  });

  it("handles trailing slash by returning empty string", () => {
    expect(basename("/foo/bar/")).toBe("");
  });

  it("handles empty string", () => {
    expect(basename("")).toBe("");
  });
});
