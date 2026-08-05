import type { DiffFile, DiffLine, DiffSide } from "../types";

// lineNumberOnSide returns the line's number on the given side, or null when
// the line doesn't belong to that side (an "add" has no old-side counterpart,
// a "delete" has no new-side counterpart). This is the single definition of
// "does this diff line exist on side X" — snapshot collection and comment
// anchoring both build on it.
export function lineNumberOnSide(line: DiffLine, side: DiffSide): number | null {
  if (side === "old" && line.type === "add") return null;
  if (side === "new" && line.type === "delete") return null;
  return (side === "old" ? line.oldLineNumber : line.newLineNumber) ?? null;
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
      const ln = lineNumberOnSide(line, side);
      if (ln == null || ln < lo || ln > hi) continue;
      out.push(line.content);
    }
  }
  return out.join("\n");
}
