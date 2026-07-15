import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ThemedToken } from "shiki";
import type {
  CommentThread,
  DiffFile,
  DiffLine,
  DiffSide,
  DiffViewMode,
} from "../types";
import { DiffChunk } from "./DiffChunk";
import { SplitDiffChunk } from "./SplitDiffChunk";
import { CommentCard } from "./CommentCard";
import { CommentForm } from "./CommentForm";
import { useHighlighter, detectLanguage } from "../hooks/useHighlighter";
import { STATUS_META } from "../constants/status";
import type { RangeState } from "../constants/diff";
import { isAutoFoldPath } from "../constants/autoFold";
import type { CommitContext } from "../utils/commentPrompt";
import { collectRangeSnapshot, pickSideAndLine } from "../utils/diffLine";
import { buildExpandedLines, computeGaps } from "../utils/expandGap";
import { fetchBlobLines } from "../utils/blobLines";

const EXPAND_STEP = 20;

interface DiffViewerProps {
  file: DiffFile;
  shikiTheme: string;
  viewMode: DiffViewMode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  threads: CommentThread[];
  commitContext?: CommitContext;
  workspaceId?: string;
  onAddComment: (params: {
    filePath: string;
    side: DiffSide;
    line: number;
    endLine?: number;
    body: string;
    codeSnapshot: string;
  }) => void;
  onUpdateComment: (threadId: string, messageId: string, body: string) => void;
  onRemoveComment: (threadId: string) => void;
  onCommentCopied?: () => void;
}

// ExpandedRange represents the context lines already fetched for the gap
// immediately above a given chunk. Both sides advance in lock-step because
// expanded regions are unchanged context. The stored line numbers point at the
// first line of `lines`; the remaining numbers are derived by offset.
interface ExpandedRange {
  newStart: number;
  oldStart: number;
  lines: string[];
}

interface PendingForm {
  side: DiffSide;
  // line/endLine are the inclusive range. For single-line comments they are equal.
  line: number;
  endLine: number;
  // anchorLine is the originating line of this selection — set by the initial
  // plain click and never moved by subsequent Shift+clicks. Range endpoints
  // are recomputed as min/max(anchorLine, latest shift-click line).
  anchorLine: number;
  // formAt is the line under which the comment input is rendered. Matches the
  // most recent Shift+clicked line (GitHub shows the form under the
  // terminal line of the range).
  formAt: number;
  content: string;
}

function lineKey(side: DiffSide, line: number): string {
  return `${side}:${line}`;
}

export function DiffViewer({
  file,
  shikiTheme,
  viewMode,
  collapsed,
  onToggleCollapsed,
  threads,
  commitContext,
  workspaceId,
  onAddComment,
  onUpdateComment,
  onRemoveComment,
  onCommentCopied,
}: DiffViewerProps) {
  const meta = STATUS_META[file.status] ?? STATUS_META.modified;
  const autoFold = isAutoFoldPath(file.path);
  const { ready, highlightLines } = useHighlighter();

  // The diff table lives inside a horizontally-scrolling container. Comment
  // forms are rendered in full-width rows inside that table, so when a long
  // code line widens the table beyond the viewport the form (and its save
  // button) gets pushed off-screen to the right. We measure the *visible*
  // width of the scroll container and pin the form contents to it with
  // `sticky left-0`, so the form stays within view regardless of scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed, file.isBinary]);

  // Per-gap expansion state. Keyed by `beforeChunkIndex` (the index of the
  // chunk this gap precedes, or chunks.length for the trailing gap).
  const [expanded, setExpanded] = useState<Map<number, ExpandedRange>>(new Map());
  // totalNewLines is needed to know how far the trailing gap extends. We
  // populate it lazily on the first attempt to expand the trailing gap.
  const [totalNewLines, setTotalNewLines] = useState<number | undefined>();
  // Reset expansion when the underlying file (commit / path) changes.
  useEffect(() => {
    setExpanded(new Map());
    setTotalNewLines(undefined);
  }, [file.path, commitContext?.hash]);

  const gaps = useMemo(
    () => computeGaps(file, totalNewLines),
    [file, totalNewLines],
  );

  // canExpand is the gating predicate for showing expander UI at all. Without
  // a workspace context we cannot fetch blob lines, so the whole feature is
  // hidden for stdin-supplied diffs that aren't associated with any workspace.
  const canExpand = Boolean(workspaceId) && !file.isBinary && file.status !== "added" && file.status !== "deleted";

  // loadGap fetches more context for the gap immediately above `chunkIndex`.
  // Expanded lines always stack directly above the chunk header (matching
  // GitHub). The `direction` only affects *which* portion of the still-hidden
  // range to pull next:
  //   - "up":   take `step` lines closest to the chunk (so existing context
  //             grows further away). This is the default header click.
  //   - "down": take `step` lines from the top of the gap (closer to the
  //             previous hunk / file start), useful when the user wants to
  //             see the upper end of the gap first.
  //   - "all":  pull the entire remaining gap.
  const loadGap = async (
    chunkIndex: number,
    direction: "up" | "down" | "all",
  ) => {
    const gap = gaps.find((g) => g.beforeChunkIndex === chunkIndex);
    if (!gap) return;
    const existing = expanded.get(chunkIndex);

    // The still-hidden range is the gap minus any already-fetched portion.
    // Stored lines occupy [existing.newStart, existing.newStart + len - 1].
    let hiddenNewStart = gap.newStart;
    let hiddenNewEnd = gap.newEnd;
    let hiddenOldStart = gap.oldStart;
    let hiddenOldEnd = gap.oldEnd;
    if (existing) {
      // Already-fetched lines sit just above the chunk header, so they
      // consume the *bottom* of the gap. Reduce the hidden range from below.
      hiddenNewEnd = existing.newStart - 1;
      hiddenOldEnd = existing.oldStart - 1;
    }
    if (hiddenNewEnd < hiddenNewStart) return;

    let reqNewStart: number;
    let reqNewEnd: number;
    let reqOldStart: number;

    if (direction === "all") {
      reqNewStart = hiddenNewStart;
      reqNewEnd = hiddenNewEnd;
      reqOldStart = hiddenOldStart;
    } else if (direction === "up") {
      // Bottom of the hidden range (closest to the chunk header).
      reqNewEnd = hiddenNewEnd;
      reqNewStart = Math.max(hiddenNewStart, hiddenNewEnd - EXPAND_STEP + 1);
      reqOldStart = Math.max(hiddenOldStart, hiddenOldEnd - EXPAND_STEP + 1);
    } else {
      // Top of the hidden range (closest to the previous hunk / file start).
      reqNewStart = hiddenNewStart;
      reqNewEnd = Math.min(hiddenNewEnd, hiddenNewStart + EXPAND_STEP - 1);
      reqOldStart = hiddenOldStart;
    }
    if (reqNewEnd < reqNewStart) return;

    const res = await fetchBlobLines({
      workspaceId,
      commit: commitContext?.hash,
      path: file.path,
      side: "new",
      start: reqNewStart,
      end: reqNewEnd,
    });
    if (!res || res.lines.length === 0) return;
    if (totalNewLines == null) setTotalNewLines(res.totalLines);

    setExpanded((prev) => {
      const next = new Map(prev);
      const prior = next.get(chunkIndex);
      if (!prior) {
        next.set(chunkIndex, {
          newStart: reqNewStart,
          oldStart: reqOldStart,
          lines: res.lines,
        });
        return next;
      }
      // Merge by ordering on line numbers: fetched lines may sit above or
      // below the existing block depending on direction.
      const fetchedStart = reqNewStart;
      const fetchedEnd = reqNewStart + res.lines.length - 1;
      const priorEnd = prior.newStart + prior.lines.length - 1;
      if (fetchedEnd + 1 === prior.newStart) {
        // Fetched chunk sits directly above existing block: prepend.
        next.set(chunkIndex, {
          newStart: fetchedStart,
          oldStart: reqOldStart,
          lines: [...res.lines, ...prior.lines],
        });
      } else if (priorEnd + 1 === fetchedStart) {
        // Fetched chunk sits directly below existing block: append.
        next.set(chunkIndex, {
          ...prior,
          lines: [...prior.lines, ...res.lines],
        });
      } else {
        // Non-contiguous (gap between fetched and existing) — keep the newest
        // fetch alone. In practice this only happens if the user clicked
        // "down" with a non-empty hidden range above, then "up" again; the
        // simpler behavior is to replace so the visible block stays a single
        // contiguous range above the chunk.
        next.set(chunkIndex, {
          newStart: fetchedStart,
          oldStart: reqOldStart,
          lines: res.lines,
        });
      }
      return next;
    });
  };

  const [pending, setPending] = useState<PendingForm | null>(null);
  // shiftHeld drives row-level UI changes while the user holds Shift: the
  // per-line "add comment" button is hidden so it doesn't block clicks on the
  // line itself, mirroring how GitHub PR review behaves during range selection.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    // window blur can leave Shift "stuck" if the user releases off-window.
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const threadsByLine = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    for (const t of threads) {
      // Anchor on end line so multi-line cards render below the selection
      // bottom, matching the form's position at save time.
      const anchorLine = t.endLine ?? t.line;
      const key = lineKey(t.side, anchorLine);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [threads]);

  // Tokens are computed per chunk, and within a chunk as two separate
  // documents: one for the old-side text (unchanged + deleted lines, plus
  // any expander-fetched context) and one for the new-side text (unchanged +
  // added lines). Two correctness constraints drive this:
  //
  // 1. A unified diff interleaves lines from two different file versions, so
  //    concatenating add/delete lines naively can pair up delimiters (e.g. a
  //    raw string's opening backtick on a deleted line with an unrelated
  //    backtick on an added line) that were never adjacent in either real
  //    file — corrupting the highlight state for everything after.
  // 2. Hunks omit the unchanged lines between them. Concatenating text
  //    across chunk boundaries silently drops that omitted text, so a
  //    multi-line construct (like a raw string) that opens in one chunk and
  //    closes in another gets tokenized with a chunk of its middle missing —
  //    also corrupting highlight state. So each chunk (plus its own expanded
  //    context, which is contiguous with it) is tokenized independently;
  //    state is never shared across chunks.
  const allLineTokens = useMemo(() => {
    if (collapsed) return null;
    if (!ready || file.chunks.length === 0) return null;

    const lang = detectLanguage(file.path);
    let anyTokens = false;

    const result = file.chunks.map((chunk, i) => {
      const ex = expanded.get(i);
      const expandedLen = ex?.lines.length ?? 0;
      const oldLines: string[] = ex ? [...ex.lines] : [];
      const newLines: string[] = ex ? [...ex.lines] : [];
      const chunkLineSides: ("old" | "new")[] = [];
      for (const line of chunk.lines) {
        if (line.type === "add") {
          chunkLineSides.push("new");
          newLines.push(line.content);
        } else {
          // "normal" lines are identical text on both sides; old is used
          // arbitrarily since either document's tokens are equivalent.
          chunkLineSides.push("old");
          oldLines.push(line.content);
        }
      }

      const oldTokens = highlightLines(oldLines, lang, shikiTheme);
      const newTokens = highlightLines(newLines, lang, shikiTheme);
      if (oldTokens.length > 0 || newTokens.length > 0) anyTokens = true;

      const expandedTokens: (ThemedToken[] | undefined)[] = [];
      for (let j = 0; j < expandedLen; j++) {
        expandedTokens.push(oldTokens[j]);
      }
      let oldIdx = expandedLen;
      let newIdx = expandedLen;
      const lineTokens: (ThemedToken[] | undefined)[] = [];
      for (const side of chunkLineSides) {
        if (side === "new") {
          lineTokens.push(newTokens[newIdx]);
          newIdx++;
        } else {
          lineTokens.push(oldTokens[oldIdx]);
          oldIdx++;
        }
      }
      return { expandedAbove: expandedTokens, lines: lineTokens };
    });

    return anyTokens ? result : null;
  }, [ready, file, shikiTheme, highlightLines, collapsed, expanded]);

  const handleAddComment = (
    side: DiffSide,
    line: number,
    content: string,
    extend: boolean,
  ) => {
    // Shift+click with an open pending form on the same side.
    if (extend && pending && pending.side === side && pending.anchorLine !== line) {
      // Clicking above the anchor cancels the existing selection and starts a
      // fresh single-line pending at the clicked line.
      if (line < pending.anchorLine) {
        setPending({ side, line, endLine: line, anchorLine: line, formAt: line, content });
        return;
      }
      // Otherwise extend the range downward from the unchanged anchor.
      const snapshot = collectRangeSnapshot(file, side, pending.anchorLine, line);
      setPending({
        side,
        line: pending.anchorLine,
        endLine: line,
        anchorLine: pending.anchorLine,
        formAt: line,
        content: snapshot,
      });
      return;
    }
    // Plain click (or Shift+click without a prior pending form): single-line form.
    setPending({ side, line, endLine: line, anchorLine: line, formAt: line, content });
  };

  // Expanded into a per-line Set for O(1) hit-testing during render — diff
  // tables can have hundreds of rows checked per render, so range scans matter.
  const committedLinesBySide = useMemo(() => {
    const map: Record<DiffSide, Set<number>> = { old: new Set(), new: new Set() };
    for (const t of threads) {
      const end = t.endLine ?? t.line;
      const lo = Math.min(t.line, end);
      const hi = Math.max(t.line, end);
      for (let ln = lo; ln <= hi; ln++) map[t.side].add(ln);
    }
    return map;
  }, [threads]);

  const rangeStateFor = (
    targetSide: DiffSide,
    targetLine: number,
  ): RangeState | null => {
    if (pending && pending.side === targetSide) {
      if (targetLine >= pending.line && targetLine <= pending.endLine) {
        return targetLine === pending.anchorLine ? "anchor" : "in-range";
      }
    }
    if (committedLinesBySide[targetSide].has(targetLine)) return "committed";
    return null;
  };

  const rangeStateForLineUnified = (line: DiffLine): RangeState | null => {
    const t = pickSideAndLine(line);
    if (!t) return null;
    return rangeStateFor(t.side, t.lineNumber);
  };

  const rangeStateForSplit = (side: DiffSide, line: DiffLine): RangeState | null => {
    const ln = side === "old" ? line.oldLineNumber : line.newLineNumber;
    if (ln == null) return null;
    return rangeStateFor(side, ln);
  };

  const renderExtra = (
    targetSide: DiffSide,
    targetLine: number,
  ): ReactNode => {
    const key = lineKey(targetSide, targetLine);
    const lineThreads = threadsByLine.get(key) ?? [];
    const showForm = pending?.side === targetSide && pending.formAt === targetLine;
    if (lineThreads.length === 0 && !showForm) return null;
    return (
      <div
        className="flex flex-col gap-2 sticky left-0"
        style={viewportWidth != null ? { width: viewportWidth } : undefined}
      >
        {lineThreads.map((t) => (
          <CommentCard
            key={t.id}
            thread={t}
            commitContext={commitContext}
            onUpdateBody={(msgId, body) => onUpdateComment(t.id, msgId, body)}
            onRemove={() => onRemoveComment(t.id)}
            onCopied={onCommentCopied}
          />
        ))}
        {showForm && pending && (
          <CommentForm
            onSubmit={(body) => {
              onAddComment({
                filePath: file.path,
                side: pending.side,
                line: pending.line,
                endLine: pending.endLine !== pending.line ? pending.endLine : undefined,
                body,
                codeSnapshot: pending.content,
              });
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    );
  };

  const renderUnifiedExtra = (line: DiffLine): ReactNode => {
    const target = pickSideAndLine(line);
    if (!target) return null;
    return renderExtra(target.side, target.lineNumber);
  };

  const renderSplitExtra = (line: DiffLine, side: DiffSide): ReactNode => {
    const lineNumber = side === "old" ? line.oldLineNumber : line.newLineNumber;
    if (lineNumber == null) return null;
    return renderExtra(side, lineNumber);
  };

  return (
    <div
      id={`file-${encodeURIComponent(file.path)}`}
      className="border border-gh-border rounded-md mb-4 overflow-hidden"
    >
      {/* File header */}
      <div
        className={`bg-gh-bg-secondary px-4 py-2 flex items-center gap-2 sticky top-0 z-10 ${collapsed ? "" : "border-b border-gh-border"}`}
      >
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand file" : "Collapse file"}
          className="p-0.5 -ml-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors shrink-0"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className={`font-bold text-sm ${autoFold ? "text-gh-text-muted/60" : meta.colorClass}`}>
          {meta.label}
        </span>
        <span
          className={`font-mono text-sm truncate ${autoFold ? "text-gh-text-muted/70 italic" : "text-gh-text-primary"}`}
          title={autoFold ? "自動折りたたみ対象（自動生成・lockファイルなど）" : undefined}
        >
          {file.oldPath ? (
            <>
              <span className="text-gh-text-muted">{file.oldPath}</span>
              <span className="text-gh-text-muted mx-1">&rarr;</span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        {threads.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
            💬 {threads.length}
          </span>
        )}
        <span className="ml-auto flex gap-2 text-xs shrink-0">
          {file.additions > 0 && (
            <span className="text-green-400">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-400">-{file.deletions}</span>
          )}
        </span>
      </div>

      {/* Diff content */}
      {collapsed ? null : file.isBinary ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          Binary file not shown
        </div>
      ) : file.chunks.length === 0 ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          No changes
        </div>
      ) : (
        <div className="overflow-x-auto" ref={scrollRef}>
          <table
            className={`border-collapse ${viewMode === "split" ? "w-full table-fixed" : "w-full"}`}
          >
            {viewMode === "split" && (
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "50%" }} />
                <col style={{ width: "40px" }} />
                <col style={{ width: "50%" }} />
              </colgroup>
            )}
            <tbody>
              {file.chunks.map((chunk, i) => {
                const gap = gaps.find((g) => g.beforeChunkIndex === i);
                const ex = expanded.get(i);
                const hasGap = canExpand && Boolean(gap);
                const expandedSoFar = ex?.lines.length ?? 0;
                const gapTotal = gap
                  ? Math.max(gap.newEnd - gap.newStart + 1, gap.oldEnd - gap.oldStart + 1)
                  : 0;
                const remaining = gapTotal - expandedSoFar;
                // Up-direction expansion is impossible when no gap above the
                // chunk (= first chunk starts at line 1). Down stays available
                // whenever there's still hidden context.
                const canUp = hasGap && remaining > 0;
                const canDown = hasGap && remaining > 0;
                // Hide the `@@ ... @@` header whenever the line numbers above
                // and below it are already contiguous — the header would just
                // be visual noise between adjacent line numbers. The "row above
                // the header" is the previous hunk's last line (or 0 before
                // the first hunk); the "row below" is the first visible line
                // of this hunk, which is the start of any expanded prefix when
                // present, otherwise the hunk's own oldStart/newStart.
                const prevChunk = i > 0 ? file.chunks[i - 1] : null;
                const prevOldEnd = prevChunk
                  ? prevChunk.oldStart + prevChunk.oldLines - 1
                  : 0;
                const prevNewEnd = prevChunk
                  ? prevChunk.newStart + prevChunk.newLines - 1
                  : 0;
                const displayOldStart = ex ? ex.oldStart : chunk.oldStart;
                const displayNewStart = ex ? ex.newStart : chunk.newStart;
                const hideHeader =
                  displayOldStart === prevOldEnd + 1 &&
                  displayNewStart === prevNewEnd + 1;
                const expandedLines = ex
                  ? buildExpandedLines(ex.lines, ex.oldStart, ex.newStart)
                  : undefined;
                const segTokens = allLineTokens?.[i];
                if (viewMode === "split") {
                  return (
                    <SplitDiffChunk
                      key={`chunk-${i}`}
                      chunk={chunk}
                      lineTokens={segTokens?.lines}
                      onAddComment={handleAddComment}
                      renderLineExtra={renderSplitExtra}
                      rangeStateFor={rangeStateForSplit}
                      hideAddButton={shiftHeld}
                      expandedAbove={expandedLines}
                      expandedAboveTokens={segTokens?.expandedAbove}
                      onExpandUp={canUp ? () => void loadGap(i, "up") : undefined}
                      onExpandDown={canDown ? () => void loadGap(i, "down") : undefined}
                      onExpandAll={hasGap && remaining > 0 ? () => void loadGap(i, "all") : undefined}
                      canExpandUp={canUp}
                      canExpandDown={canDown}
                      hideHeader={hideHeader}
                    />
                  );
                }
                return (
                  <DiffChunk
                    key={`chunk-${i}`}
                    chunk={chunk}
                    lineTokens={segTokens?.lines}
                    onAddComment={handleAddComment}
                    renderLineExtra={renderUnifiedExtra}
                    rangeStateForLine={rangeStateForLineUnified}
                    hideAddButton={shiftHeld}
                    expandedAbove={expandedLines}
                    expandedAboveTokens={segTokens?.expandedAbove}
                    onExpandUp={canUp ? () => void loadGap(i, "up") : undefined}
                    onExpandDown={canDown ? () => void loadGap(i, "down") : undefined}
                    onExpandAll={hasGap && remaining > 0 ? () => void loadGap(i, "all") : undefined}
                    canExpandUp={canUp}
                    canExpandDown={canDown}
                    hideHeader={hideHeader}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
