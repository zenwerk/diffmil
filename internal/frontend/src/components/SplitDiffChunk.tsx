import type { ThemedToken } from "shiki";
import type { DiffChunk, DiffLine } from "../types";

interface SplitDiffChunkProps {
  chunk: DiffChunk;
  lineTokens?: (ThemedToken[] | undefined)[];
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
      // Collect consecutive deletes
      const deletes: number[] = [];
      while (i < lines.length && lines[i].type === "delete") {
        deletes.push(i);
        i++;
      }
      // Collect consecutive adds
      const adds: number[] = [];
      while (i < lines.length && lines[i].type === "add") {
        adds.push(i);
        i++;
      }
      // Pair them up
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
      // Standalone add (no preceding delete)
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
  tokens,
}: {
  side: { line: DiffLine; tokens?: ThemedToken[] } | null;
  tokens?: ThemedToken[];
}) {
  if (!side) {
    return (
      <>
        <td className="w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap bg-gh-bg-tertiary/50" />
        <td className="px-2 font-mono text-sm whitespace-pre bg-gh-bg-tertiary/50" />
      </>
    );
  }

  const { line } = side;
  const effectiveTokens = tokens ?? side.tokens;

  const bgClass =
    line.type === "add"
      ? "bg-diff-addition-bg"
      : line.type === "delete"
        ? "bg-diff-deletion-bg"
        : "";

  const lineNum =
    line.type === "delete" ? line.oldLineNumber : line.newLineNumber;

  const prefix =
    line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

  return (
    <>
      <td
        className={`w-[1%] min-w-[40px] px-1.5 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap ${bgClass}`}
      >
        {lineNum ?? ""}
      </td>
      <td
        className={`px-2 font-mono text-sm whitespace-pre overflow-x-auto ${bgClass}`}
      >
        <span className="text-gh-text-muted select-none">{prefix}</span>
        {effectiveTokens && effectiveTokens.length > 0
          ? effectiveTokens.map((token, i) => (
              <span key={i} style={{ color: token.color }}>
                {token.content}
              </span>
            ))
          : line.content}
      </td>
    </>
  );
}

export function SplitDiffChunk({ chunk, lineTokens }: SplitDiffChunkProps) {
  const rows = buildSplitRows(chunk, lineTokens);

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
        <tr key={i} className="hover:brightness-125">
          <SplitCell side={row.left} />
          <SplitCell side={row.right} />
        </tr>
      ))}
    </>
  );
}
