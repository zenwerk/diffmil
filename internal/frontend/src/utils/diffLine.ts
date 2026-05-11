import type { DiffLine, DiffSide } from "../types";

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
