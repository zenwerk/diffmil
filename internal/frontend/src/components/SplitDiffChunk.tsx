import { Fragment, useMemo, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { DiffChunk, DiffLine, DiffSide } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX, LINE_BG } from "../constants/diff";

interface SplitDiffChunkProps {
  chunk: DiffChunk;
  lineTokens?: (ThemedToken[] | undefined)[];
  onAddComment?: (side: DiffSide, lineNumber: number, content: string) => void;
  renderLineExtra?: (line: DiffLine, side: DiffSide) => ReactNode;
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
}: {
  cell: { line: DiffLine; tokens?: ThemedToken[] } | null;
  side: DiffSide;
  onAddComment?: (side: DiffSide, lineNumber: number, content: string) => void;
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
  const bg = LINE_BG[line.type] ?? "";
  const lineNum =
    side === "old" ? line.oldLineNumber : line.newLineNumber;
  const canComment = onAddComment != null && lineNum != null;

  return (
    <>
      <td
        className={`w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative ${bg}`}
      >
        {lineNum ?? ""}
        {canComment && (
          <button
            type="button"
            onClick={() => onAddComment(side, lineNum, line.content)}
            title="コメントを追加"
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
        return (
          <Fragment key={i}>
            <tr className="group">
              <SplitCell cell={row.left} side="old" onAddComment={onAddComment} />
              <SplitCell cell={row.right} side="new" onAddComment={onAddComment} />
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
