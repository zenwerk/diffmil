import type { AnnotationSide, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { CommentThread, DiffFile, DiffSide } from "../types";

// @pierre/diffs names diff sides after the change they carry: the left column
// (pre-image) is 'deletions', the right column (post-image) is 'additions'.
// diffmil's storage schema predates the pierre renderer and uses old/new, so
// every value crossing the boundary is mapped through these two helpers rather
// than being translated ad hoc at each call site.
export function toAnnotationSide(side: DiffSide): AnnotationSide {
  return side === "old" ? "deletions" : "additions";
}

export function toDiffSide(side: AnnotationSide | undefined): DiffSide {
  return side === "deletions" ? "old" : "new";
}

// PendingForm mirrors the legacy DiffViewer's pending-comment state. `line`
// and `endLine` are the inclusive selected range; `formAt` is the line under
// which the input is rendered (the range's terminal line, matching GitHub).
export interface PendingForm {
  side: DiffSide;
  line: number;
  endLine: number;
  formAt: number;
  // content is the code snapshot captured for the range at selection time. It
  // is stored on the thread so a comment keeps the code it referred to even
  // after the underlying diff changes.
  content: string;
}

// AnnotationMeta is a discriminated union so `renderAnnotation` can switch on
// `kind` without null-checking two optional payload fields. The library keys
// annotation slots by (side, lineNumber), so the two kinds must never collide
// on the same line — `buildAnnotations` guarantees that by merging the pending
// form into the same annotation as any threads anchored on that line.
// `kind` discriminates the three states; `threads` is always present (empty
// for a bare form) rather than being union-optional. The library's
// `DiffLineAnnotation<T>` wraps T in a conditional `OptionalMetadata<T>`, which
// distributes over a union type and then demands that `metadata` satisfy every
// member at once — so a naive union here is not assignable. Keeping the type a
// single object shape with a discriminant field sidesteps that while still
// letting `renderAnnotation` switch on `kind`.
export interface AnnotationMeta {
  kind: "threads" | "form" | "threads-and-form";
  threads: CommentThread[];
}

function annotationKey(side: AnnotationSide, lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

// anchorLineOf returns the line a thread's card is rendered under. Multi-line
// threads anchor on their last line so the card appears below the bottom of
// the highlighted range — the same position the form occupied at save time.
export function anchorLineOf(thread: CommentThread): number {
  return thread.endLine ?? thread.line;
}

// buildAnnotations converts diffmil's comment state into the annotation list
// @pierre/diffs renders. Threads sharing an anchor line are grouped into a
// single annotation because the library renders exactly one slot per
// (side, lineNumber) — emitting duplicates would silently drop all but one.
//
// Ordering is deterministic: annotations are emitted in ascending (side, line)
// order, with 'deletions' before 'additions', so the returned array is stable
// across renders given equal input. Within a line, threads keep their input
// order (the caller supplies them already sorted by creation time).
export function buildAnnotations(
  threads: CommentThread[],
  pending: PendingForm | null,
): DiffLineAnnotation<AnnotationMeta>[] {
  const byKey = new Map<
    string,
    { side: AnnotationSide; lineNumber: number; threads: CommentThread[]; form: boolean }
  >();

  const entryFor = (side: AnnotationSide, lineNumber: number) => {
    const key = annotationKey(side, lineNumber);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { side, lineNumber, threads: [], form: false };
      byKey.set(key, entry);
    }
    return entry;
  };

  for (const thread of threads) {
    const side = toAnnotationSide(thread.side);
    entryFor(side, anchorLineOf(thread)).threads.push(thread);
  }

  if (pending) {
    entryFor(toAnnotationSide(pending.side), pending.formAt).form = true;
  }

  const entries = [...byKey.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side === "deletions" ? -1 : 1;
    return a.lineNumber - b.lineNumber;
  });

  return entries.map(({ side, lineNumber, threads: lineThreads, form }) => {
    const kind: AnnotationMeta["kind"] = form
      ? lineThreads.length > 0
        ? "threads-and-form"
        : "form"
      : "threads";
    return { side, lineNumber, metadata: { kind, threads: lineThreads } };
  });
}

// buildSelectedLines renders the pending range as a controlled selection so
// the lines being commented on stay highlighted while the form is open. A
// single-line pending still produces a range (start === end), which is how the
// library represents a one-line selection.
export function buildSelectedLines(pending: PendingForm | null): SelectedLineRange | null {
  if (!pending) return null;
  const side = toAnnotationSide(pending.side);
  return {
    start: Math.min(pending.line, pending.endLine),
    side,
    end: Math.max(pending.line, pending.endLine),
    endSide: side,
  };
}

// hasLineOnSide reports whether a line number actually exists on the given
// side within the patch's own hunks. Context lines fetched by @pierre/diffs'
// expansion loader are not part of `file.chunks`, so this doubles as the guard
// that keeps comments off expanded lines — matching the legacy renderer, which
// only ever offered the comment button on rows it rendered from the patch.
export function hasLineOnSide(file: DiffFile, side: DiffSide, lineNumber: number): boolean {
  for (const chunk of file.chunks) {
    for (const line of chunk.lines) {
      // A line only belongs to a side if the diff kept it there: an 'add' has
      // no old-side counterpart and a 'delete' has no new-side counterpart.
      if (side === "old" && line.type === "add") continue;
      if (side === "new" && line.type === "delete") continue;
      const ln = side === "old" ? line.oldLineNumber : line.newLineNumber;
      if (ln === lineNumber) return true;
    }
  }
  return false;
}

// clampRangeToPatch narrows a selection to the lines that exist on `side`
// within the patch. The library's drag/shift selection can sweep across
// expanded context (and, in unified view, across the opposite side's rows), so
// the raw range may include lines that carry no comment anchor. Returns null
// when nothing in the range is commentable.
export function clampRangeToPatch(
  file: DiffFile,
  side: DiffSide,
  start: number,
  end: number,
): { line: number; endLine: number } | null {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let first: number | undefined;
  let last: number | undefined;
  for (let ln = lo; ln <= hi; ln++) {
    if (!hasLineOnSide(file, side, ln)) continue;
    if (first === undefined) first = ln;
    last = ln;
  }
  if (first === undefined || last === undefined) return null;
  return { line: first, endLine: last };
}
