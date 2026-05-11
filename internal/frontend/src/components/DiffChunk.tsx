import { Fragment, type ReactNode } from "react";
import type { ThemedToken } from "shiki";
import type { DiffChunk as DiffChunkType, DiffLine, DiffSide } from "../types";
import { DiffLineRow } from "./DiffLineRow";

interface DiffChunkProps {
  chunk: DiffChunkType;
  lineTokens?: (ThemedToken[] | undefined)[];
  onAddComment?: (side: DiffSide, lineNumber: number, content: string) => void;
  renderLineExtra?: (line: DiffLine) => ReactNode;
}

export function DiffChunk({
  chunk,
  lineTokens,
  onAddComment,
  renderLineExtra,
}: DiffChunkProps) {
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
      {chunk.lines.map((line, i) => {
        const extra = renderLineExtra?.(line);
        return (
          <Fragment key={i}>
            <DiffLineRow
              line={line}
              tokens={lineTokens?.[i]}
              onAddComment={onAddComment}
            />
            {extra && (
              <tr>
                <td colSpan={3} className="p-2 bg-gh-bg-primary">
                  {extra}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
