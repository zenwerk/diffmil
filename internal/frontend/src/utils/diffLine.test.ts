import { describe, it, expect } from "vitest";
import { pickSideAndLine } from "./diffLine";
import type { DiffLine } from "../types";

const mkLine = (overrides: Partial<DiffLine>): DiffLine => ({
  type: "normal",
  content: "",
  ...overrides,
});

describe("pickSideAndLine", () => {
  it("picks old for delete lines", () => {
    expect(pickSideAndLine(mkLine({ type: "delete", oldLineNumber: 10 }))).toEqual({
      side: "old",
      lineNumber: 10,
    });
  });

  it("picks new for add lines", () => {
    expect(pickSideAndLine(mkLine({ type: "add", newLineNumber: 5 }))).toEqual({
      side: "new",
      lineNumber: 5,
    });
  });

  it("picks new for normal lines when newLineNumber is set", () => {
    expect(
      pickSideAndLine(mkLine({ type: "normal", oldLineNumber: 3, newLineNumber: 7 })),
    ).toEqual({ side: "new", lineNumber: 7 });
  });

  it("falls back to old when only oldLineNumber is set", () => {
    expect(pickSideAndLine(mkLine({ type: "normal", oldLineNumber: 3 }))).toEqual({
      side: "old",
      lineNumber: 3,
    });
  });

  it("returns null when nothing is set", () => {
    expect(pickSideAndLine(mkLine({ type: "normal" }))).toBeNull();
  });
});
