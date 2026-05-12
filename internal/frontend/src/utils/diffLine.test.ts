import { describe, it, expect } from "vitest";
import { collectRangeSnapshot, pickSideAndLine } from "./diffLine";
import type { DiffFile, DiffLine } from "../types";

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

describe("collectRangeSnapshot", () => {
  const file: DiffFile = {
    path: "src/foo.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    chunks: [
      {
        header: "@@",
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 5,
        lines: [
          mkLine({
            type: "normal",
            content: "  ctx",
            oldLineNumber: 10,
            newLineNumber: 10,
          }),
          mkLine({
            type: "delete",
            content: "  old",
            oldLineNumber: 11,
          }),
          mkLine({
            type: "add",
            content: "  new1",
            newLineNumber: 11,
          }),
          mkLine({
            type: "add",
            content: "  new2",
            newLineNumber: 12,
          }),
          mkLine({
            type: "normal",
            content: "  end",
            oldLineNumber: 12,
            newLineNumber: 13,
          }),
        ],
      },
    ],
  };

  it("joins new-side lines within the range", () => {
    expect(collectRangeSnapshot(file, "new", 10, 12)).toBe("  ctx\n  new1\n  new2");
  });

  it("excludes delete lines when collecting the new side", () => {
    // The deletion at oldLineNumber=11 has no newLineNumber and must not leak in.
    expect(collectRangeSnapshot(file, "new", 11, 12)).toBe("  new1\n  new2");
  });

  it("collects old-side lines including deletions but excluding adds", () => {
    expect(collectRangeSnapshot(file, "old", 10, 12)).toBe("  ctx\n  old\n  end");
  });

  it("works when start and end are passed in reverse order", () => {
    expect(collectRangeSnapshot(file, "new", 13, 10)).toBe(
      "  ctx\n  new1\n  new2\n  end",
    );
  });

  it("returns single line when start equals end", () => {
    expect(collectRangeSnapshot(file, "new", 11, 11)).toBe("  new1");
  });
});
