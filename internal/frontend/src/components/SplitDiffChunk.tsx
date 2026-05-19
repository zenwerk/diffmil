import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { DiffChunk, DiffLine, DiffSide } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX, LINE_BG } from "../constants/diff";

interface SplitDiffChunkProps {
  chunk: DiffChunk;
  lineTokens?: (ThemedToken[] | undefined)[];
  onAddComment?: (
    side: DiffSide,
    lineNumber: number,
    content: string,
    extend: boolean,
  ) => void;
  renderLineExtra?: (line: DiffLine, side: DiffSide) => ReactNode;
  rangeStateFor?: (
    side: DiffSide,
    line: DiffLine,
  ) => "anchor" | "in-range" | "committed" | null;
  hideAddButton?: boolean;
}

interface SplitRow {
  left: { line: DiffLine; tokens?: ThemedToken[] } | null;
  right: { line: DiffLine; tokens?: ThemedToken[] } | null;
}

function buildSplitRows(
  chunk: DiffChunk,
  lineTokens?: (ThemedToken[] | undefined)[],
): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = chunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "normal") {
      rows.push({
        left: { line, tokens: lineTokens?.[i] },
        right: { line, tokens: lineTokens?.[i] },
      });
      i++;
    } else if (line.type === "delete") {
      const deletes: number[] = [];
      while (i < lines.length && lines[i].type === "delete") {
        deletes.push(i);
        i++;
      }
      const adds: number[] = [];
      while (i < lines.length && lines[i].type === "add") {
        adds.push(i);
        i++;
      }
      const maxLen = Math.max(deletes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const delIdx = deletes[j];
        const addIdx = adds[j];
        rows.push({
          left:
            delIdx !== undefined
              ? { line: lines[delIdx], tokens: lineTokens?.[delIdx] }
              : null,
          right:
            addIdx !== undefined
              ? { line: lines[addIdx], tokens: lineTokens?.[addIdx] }
              : null,
        });
      }
    } else if (line.type === "add") {
      rows.push({
        left: null,
        right: { line, tokens: lineTokens?.[i] },
      });
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

function SplitCell({
  cell,
  side,
  onAddComment,
  rangeState,
  hideAddButton,
}: {
  cell: { line: DiffLine; tokens?: ThemedToken[] } | null;
  side: DiffSide;
  onAddComment?: (
    side: DiffSide,
    lineNumber: number,
    content: string,
    extend: boolean,
  ) => void;
  rangeState?: "anchor" | "in-range" | "committed" | null;
  hideAddButton?: boolean;
}) {
  if (!cell) {
    return (
      <>
        <td className="w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap bg-gh-bg-tertiary/50" />
        <td className="px-2 font-mono text-[1em] whitespace-pre bg-gh-bg-tertiary/50" />
      </>
    );
  }

  const { line, tokens } = cell;
  const baseBg = LINE_BG[line.type] ?? "";
  const rangeBg =
    rangeState === "anchor"
      ? "bg-blue-500/20"
      : rangeState === "in-range"
        ? "bg-blue-500/10"
        : rangeState === "committed"
          ? "bg-blue-500/10"
          : "";
  const bg = rangeBg || baseBg;
  const lineNum =
    side === "old" ? line.oldLineNumber : line.newLineNumber;
  const canComment = onAddComment != null && lineNum != null;
  const showButton = canComment && !hideAddButton;
  // While Shift is held the line-number cell itself becomes a Shift+click
  // target so the user can still extend the range.
  const handleGutterClick = (e: MouseEvent) => {
    if (!canComment || !e.shiftKey) return;
    onAddComment!(side, lineNum!, line.content, true);
  };

  return (
    <>
      <td
        onClick={handleGutterClick}
        className={`w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative ${bg} ${hideAddButton && canComment ? "cursor-pointer hover:bg-blue-500/15" : ""}`}
      >
        {lineNum ?? ""}
        {showButton && (
          <button
            type="button"
            onClick={(e) => onAddComment!(side, lineNum!, line.content, e.shiftKey)}
            title="クリックでコメント / Shift+クリックで複数行コメント"
            className="absolute -right-2 top-0 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded bg-blue-500 text-white hover:bg-blue-600 shadow"
          >
            <MessageSquarePlus size={12} />
          </button>
        )}
      </td>
      <td className={`px-2 font-mono text-[1em] whitespace-pre overflow-x-auto ${bg}`}>
        <span className="text-gh-text-muted select-none">
          {LINE_PREFIX[line.type] ?? " "}
        </span>
        <TokenizedCode tokens={tokens} fallback={line.content} />
      </td>
    </>
  );
}

export function SplitDiffChunk({
  chunk,
  lineTokens,
  onAddComment,
  renderLineExtra,
  rangeStateFor,
  hideAddButton,
}: SplitDiffChunkProps) {
  const rows = useMemo(
    () => buildSplitRows(chunk, lineTokens),
    [chunk, lineTokens],
  );

  return (
    <>
      <tr className="bg-gh-bg-tertiary">
        <td
          colSpan={4}
          className="px-2 py-1 font-mono text-[0.85em] text-gh-text-muted"
        >
          {chunk.header}
        </td>
      </tr>
      {rows.map((row, i) => {
        const leftExtra = row.left ? renderLineExtra?.(row.left.line, "old") : null;
        const rightExtra = row.right ? renderLineExtra?.(row.right.line, "new") : null;
        const leftRange = row.left ? rangeStateFor?.("old", row.left.line) ?? null : null;
        const rightRange = row.right ? rangeStateFor?.("new", row.right.line) ?? null : null;
        return (
          <Fragment key={i}>
            <tr className="group">
              <SplitCell
                cell={row.left}
                side="old"
                onAddComment={onAddComment}
                rangeState={leftRange}
                hideAddButton={hideAddButton}
              />
              <SplitCell
                cell={row.right}
                side="new"
                onAddComment={onAddComment}
                rangeState={rightRange}
                hideAddButton={hideAddButton}
              />
            </tr>
            {(leftExtra || rightExtra) && (
              <tr>
                <td colSpan={2} className="p-2 bg-gh-bg-primary align-top">
                  {leftExtra}
                </td>
                <td colSpan={2} className="p-2 bg-gh-bg-primary align-top">
                  {rightExtra}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
