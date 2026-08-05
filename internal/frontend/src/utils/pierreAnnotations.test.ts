import { describe, it, expect } from "vitest";
import {
  anchorLineOf,
  buildAnnotations,
  buildSelectedLines,
  clampRangeToPatch,
  hasLineOnSide,
  toAnnotationSide,
  toDiffSide,
  type PendingForm,
} from "./pierreAnnotations";
import type { CommentThread, DiffFile, DiffSide } from "../types";

function mkThread(
  id: string,
  side: DiffSide,
  line: number,
  endLine?: number,
): CommentThread {
  return {
    id,
    commitHash: "abc123",
    filePath: "a.ts",
    side,
    line,
    ...(endLine !== undefined ? { endLine } : {}),
    codeSnapshot: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    messages: [
      {
        id: `${id}-m`,
        body: "hi",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    ],
  };
}

function mkPending(over: Partial<PendingForm> = {}): PendingForm {
  return { side: "new", line: 5, endLine: 5, formAt: 5, content: "", ...over };
}

// A small file: hunk covers old lines 10-12 and new lines 10-13, with one
// delete (old 11) and two adds (new 11, 12).
const file: DiffFile = {
  path: "a.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  chunks: [
    {
      header: "@@ -10,3 +10,4 @@",
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 4,
      lines: [
        { type: "normal", content: "ctx", oldLineNumber: 10, newLineNumber: 10 },
        { type: "delete", content: "gone", oldLineNumber: 11 },
        { type: "add", content: "new1", newLineNumber: 11 },
        { type: "add", content: "new2", newLineNumber: 12 },
        { type: "normal", content: "ctx2", oldLineNumber: 12, newLineNumber: 13 },
      ],
    },
  ],
};

describe("side mapping", () => {
  it("maps diffmil sides onto pierre annotation sides", () => {
    expect(toAnnotationSide("old")).toBe("deletions");
    expect(toAnnotationSide("new")).toBe("additions");
  });

  it("maps pierre annotation sides back onto diffmil sides", () => {
    expect(toDiffSide("deletions")).toBe("old");
    expect(toDiffSide("additions")).toBe("new");
  });

  it("treats a missing pierre side as the new side", () => {
    // The library omits `side` for unified-view selections that are
    // unambiguous; the new side is the sensible default because that is where
    // context and added lines live.
    expect(toDiffSide(undefined)).toBe("new");
  });
});

describe("anchorLineOf", () => {
  it("anchors single-line threads on their only line", () => {
    expect(anchorLineOf(mkThread("t", "new", 7))).toBe(7);
  });

  it("anchors multi-line threads on their end line", () => {
    expect(anchorLineOf(mkThread("t", "new", 7, 9))).toBe(9);
  });
});

describe("buildAnnotations", () => {
  it("returns nothing when there are no threads and no pending form", () => {
    expect(buildAnnotations([], null)).toEqual([]);
  });

  it("maps a thread onto its side and line", () => {
    expect(buildAnnotations([mkThread("t1", "old", 11)], null)).toEqual([
      {
        side: "deletions",
        lineNumber: 11,
        metadata: { kind: "threads", threads: [mkThread("t1", "old", 11)] },
      },
    ]);
  });

  it("anchors a multi-line thread on its end line", () => {
    const [annotation] = buildAnnotations([mkThread("t1", "new", 3, 8)], null);
    expect(annotation.lineNumber).toBe(8);
    expect(annotation.side).toBe("additions");
  });

  it("groups multiple threads on one line into a single annotation", () => {
    // The library renders one slot per (side, line); emitting two annotations
    // for the same anchor would drop one of the cards.
    const threads = [mkThread("t1", "new", 4), mkThread("t2", "new", 4)];
    const annotations = buildAnnotations(threads, null);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].metadata).toEqual({ kind: "threads", threads });
  });

  it("groups threads that share an anchor line via different ranges", () => {
    // A single-line thread on 8 and a 3..8 range thread both anchor on 8.
    const a = mkThread("t1", "new", 8);
    const b = mkThread("t2", "new", 3, 8);
    const annotations = buildAnnotations([a, b], null);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].metadata).toEqual({ kind: "threads", threads: [a, b] });
  });

  it("keeps threads on the same line but opposite sides separate", () => {
    const annotations = buildAnnotations(
      [mkThread("t1", "old", 5), mkThread("t2", "new", 5)],
      null,
    );
    expect(annotations.map((a) => a.side)).toEqual(["deletions", "additions"]);
  });

  it("emits a form annotation at the pending form line", () => {
    expect(buildAnnotations([], mkPending({ formAt: 12 }))).toEqual([
      { side: "additions", lineNumber: 12, metadata: { kind: "form", threads: [] } },
    ]);
  });

  it("anchors the form on formAt, not on the range start", () => {
    const annotations = buildAnnotations(
      [],
      mkPending({ line: 4, endLine: 9, formAt: 9 }),
    );
    expect(annotations[0].lineNumber).toBe(9);
  });

  it("merges the form into the same annotation when a thread shares its line", () => {
    // Two annotations on one (side, line) would collide in the library's slot
    // map, so the form and the cards must travel together.
    const thread = mkThread("t1", "new", 6);
    const annotations = buildAnnotations([thread], mkPending({ formAt: 6 }));
    expect(annotations).toHaveLength(1);
    expect(annotations[0].metadata).toEqual({
      kind: "threads-and-form",
      threads: [thread],
    });
  });

  it("does not merge the form into a thread on the other side", () => {
    const thread = mkThread("t1", "old", 6);
    const annotations = buildAnnotations([thread], mkPending({ side: "new", formAt: 6 }));
    expect(annotations).toHaveLength(2);
    expect(annotations.map((a) => a.metadata.kind)).toEqual(["threads", "form"]);
  });

  it("orders annotations by side then line for a stable array", () => {
    const annotations = buildAnnotations(
      [
        mkThread("t1", "new", 20),
        mkThread("t2", "old", 5),
        mkThread("t3", "new", 3),
        mkThread("t4", "old", 30),
      ],
      null,
    );
    expect(annotations.map((a) => `${a.side}:${a.lineNumber}`)).toEqual([
      "deletions:5",
      "deletions:30",
      "additions:3",
      "additions:20",
    ]);
  });
});

describe("buildSelectedLines", () => {
  it("returns null with no pending form", () => {
    expect(buildSelectedLines(null)).toBeNull();
  });

  it("represents a single-line pending as a collapsed range", () => {
    expect(buildSelectedLines(mkPending({ line: 5, endLine: 5 }))).toEqual({
      start: 5,
      side: "additions",
      end: 5,
      endSide: "additions",
    });
  });

  it("normalizes an inverted range", () => {
    expect(buildSelectedLines(mkPending({ side: "old", line: 9, endLine: 4 }))).toEqual({
      start: 4,
      side: "deletions",
      end: 9,
      endSide: "deletions",
    });
  });
});

describe("hasLineOnSide", () => {
  it("finds context lines on both sides", () => {
    expect(hasLineOnSide(file, "old", 10)).toBe(true);
    expect(hasLineOnSide(file, "new", 10)).toBe(true);
  });

  it("finds a deleted line only on the old side", () => {
    expect(hasLineOnSide(file, "old", 11)).toBe(true);
  });

  it("finds added lines only on the new side", () => {
    expect(hasLineOnSide(file, "new", 11)).toBe(true);
    expect(hasLineOnSide(file, "new", 12)).toBe(true);
  });

  it("rejects lines outside the patch's hunks", () => {
    // Line 1 exists in the real file but not in this patch, so it can only be
    // on screen as expanded context — where comments are not offered.
    expect(hasLineOnSide(file, "new", 1)).toBe(false);
    expect(hasLineOnSide(file, "old", 99)).toBe(false);
  });

  it("rejects an old-side line number that only exists on the new side", () => {
    // New line 13 is the last context row; old 13 is past the hunk's end.
    expect(hasLineOnSide(file, "old", 13)).toBe(false);
  });
});

describe("clampRangeToPatch", () => {
  it("keeps a range that lies entirely inside the patch", () => {
    expect(clampRangeToPatch(file, "new", 10, 13)).toEqual({ line: 10, endLine: 13 });
  });

  it("trims leading and trailing lines that are not in the patch", () => {
    // 1..9 and 14..20 are expanded context around the hunk.
    expect(clampRangeToPatch(file, "new", 1, 20)).toEqual({ line: 10, endLine: 13 });
  });

  it("normalizes an inverted range before clamping", () => {
    expect(clampRangeToPatch(file, "new", 13, 10)).toEqual({ line: 10, endLine: 13 });
  });

  it("returns null when the range misses the patch entirely", () => {
    expect(clampRangeToPatch(file, "new", 1, 9)).toBeNull();
  });

  it("clamps to the old side independently of the new side", () => {
    // Old side only reaches 12, so a sweep to 13 stops there.
    expect(clampRangeToPatch(file, "old", 10, 13)).toEqual({ line: 10, endLine: 12 });
  });
});
