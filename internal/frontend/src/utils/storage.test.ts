import { describe, it, expect } from "vitest";
import { loadFromStorage, saveToStorage } from "./storage";

describe("loadFromStorage", () => {
  it("returns fallback when key is missing", () => {
    expect(loadFromStorage("missing", () => "x", "fallback")).toBe("fallback");
  });

  it("returns validated value when present", () => {
    localStorage.setItem("k", "42");
    const got = loadFromStorage<number>(
      "k",
      (s) => {
        const n = parseInt(s, 10);
        return isNaN(n) ? undefined : n;
      },
      0,
    );
    expect(got).toBe(42);
  });

  it("returns fallback when validator rejects", () => {
    localStorage.setItem("k", "abc");
    const got = loadFromStorage<number>(
      "k",
      (s) => {
        const n = parseInt(s, 10);
        return isNaN(n) ? undefined : n;
      },
      -1,
    );
    expect(got).toBe(-1);
  });
});

describe("saveToStorage", () => {
  it("writes the string value", () => {
    saveToStorage("k", "hello");
    expect(localStorage.getItem("k")).toBe("hello");
  });
});
