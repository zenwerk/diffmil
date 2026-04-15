import { useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { DiffChunk, DiffLine } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX } from "../constants/diff";

interface SplitDiffChunkProps {
  chunk: DiffChunk;
  lineTokens?: (ThemedToken[] | undefined)[];
}

interface SplitRow {
  left: { line: DiffLine; tokens?: ThemedToken[] } | null;
  right: { line: DiffLine; tokens?: ThemedToken[] } | null;
}

const LINE_BG: Record<string, string> = {
  add: "bg-diff-addition-bg",
  delete: "bg-diff-deletion-bg",
};

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
  side,
}: {
  side: { line: DiffLine; tokens?: ThemedToken[] } | null;
}) {
  if (!side) {
    return (
      <>
        <td className="w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap bg-gh-bg-tertiary/50" />
        <td className="px-2 font-mono text-sm whitespace-pre bg-gh-bg-tertiary/50" />
      </>
    );
  }

  const { line, tokens } = side;
  const bg = LINE_BG[line.type] ?? "";
  const lineNum =
    line.type === "delete" ? line.oldLineNumber : line.newLineNumber;

  return (
    <>
      <td
        className={`w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap ${bg}`}
      >
        {lineNum ?? ""}
      </td>
      <td className={`px-2 font-mono text-sm whitespace-pre overflow-x-auto ${bg}`}>
        <span className="text-gh-text-muted select-none">
          {LINE_PREFIX[line.type] ?? " "}
        </span>
        <TokenizedCode tokens={tokens} fallback={line.content} />
      </td>
    </>
  );
}

export function SplitDiffChunk({ chunk, lineTokens }: SplitDiffChunkProps) {
  const rows = useMemo(
    () => buildSplitRows(chunk, lineTokens),
    [chunk, lineTokens],
  );

  return (
    <>
      <tr className="bg-gh-bg-tertiary">
        <td
          colSpan={4}
          className="px-2 py-1 font-mono text-xs text-gh-text-muted"
        >
          {chunk.header}
        </td>
      </tr>
      {rows.map((row, i) => (
        <tr key={i}>
          <SplitCell side={row.left} />
          <SplitCell side={row.right} />
        </tr>
      ))}
    </>
  );
}
