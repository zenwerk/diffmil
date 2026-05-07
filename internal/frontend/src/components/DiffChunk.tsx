import type { ThemedToken } from "shiki";
import type { DiffChunk as DiffChunkType } from "../types";
import { DiffLineRow } from "./DiffLineRow";

interface DiffChunkProps {
  chunk: DiffChunkType;
  lineTokens?: (ThemedToken[] | undefined)[];
}

export function DiffChunk({ chunk, lineTokens }: DiffChunkProps) {
  return (
    <>
      <tr className="bg-gh-bg-tertiary">
        <td
          colSpan={3}
          className="px-2 py-1 font-mono text-[0.85em] text-gh-text-muted"
        >
          {chunk.header}
        </td>
      </tr>
      {chunk.lines.map((line, i) => (
        <DiffLineRow key={i} line={line} tokens={lineTokens?.[i]} />
      ))}
    </>
  );
}
