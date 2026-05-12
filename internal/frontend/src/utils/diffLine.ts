import type { DiffFile, DiffLine, DiffSide } from "../types";

export interface DiffLineTarget {
  side: DiffSide;
  lineNumber: number;
}

export function pickSideAndLine(line: DiffLine): DiffLineTarget | null {
  if (line.type === "delete" && line.oldLineNumber != null) {
    return { side: "old", lineNumber: line.oldLineNumber };
  }
  if (line.type === "add" && line.newLineNumber != null) {
    return { side: "new", lineNumber: line.newLineNumber };
  }
  if (line.type === "normal" && line.newLineNumber != null) {
    return { side: "new", lineNumber: line.newLineNumber };
  }
  if (line.oldLineNumber != null) {
    return { side: "old", lineNumber: line.oldLineNumber };
  }
  return null;
}

// collectRangeSnapshot returns the diff content lines for [start, end] on the
// given side within a file, joined by newline. Lines that don't belong to the
// requested side are skipped. Used to capture a multi-line code snapshot.
export function collectRangeSnapshot(
  file: DiffFile,
  side: DiffSide,
  start: number,
  end: number,
): string {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const out: string[] = [];
  for (const chunk of file.chunks) {
    for (const line of chunk.lines) {
      const ln = side === "old" ? line.oldLineNumber : line.newLineNumber;
      if (ln == null) continue;
      // Skip lines that don't belong to this side (e.g. an "add" has no
      // oldLineNumber, so it's excluded when side === "old").
      if (side === "old" && line.type === "add") continue;
      if (side === "new" && line.type === "delete") continue;
      if (ln < lo || ln > hi) continue;
      out.push(line.content);
    }
  }
  return out.join("\n");
}
