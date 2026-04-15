import { useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { DiffFile, DiffViewMode } from "../types";
import { DiffChunk } from "./DiffChunk";
import { SplitDiffChunk } from "./SplitDiffChunk";
import { useHighlighter, detectLanguage } from "../hooks/useHighlighter";
import { STATUS_META } from "../constants/status";

interface DiffViewerProps {
  file: DiffFile;
  shikiTheme: string;
  viewMode: DiffViewMode;
}

export function DiffViewer({ file, shikiTheme, viewMode }: DiffViewerProps) {
  const meta = STATUS_META[file.status] ?? STATUS_META.modified;
  const { ready, langVersion, highlightLines } = useHighlighter();

  const allLineTokens = useMemo(() => {
    if (!ready || file.chunks.length === 0) return null;

    const lang = detectLanguage(file.path);
    const allLines: string[] = [];

    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        allLines.push(line.content);
      }
    }

    const tokens = highlightLines(allLines, lang, shikiTheme);
    if (tokens.length === 0) return null;

    // Distribute tokens back to chunks
    const result: (ThemedToken[] | undefined)[][] = [];
    let idx = 0;
    for (const chunk of file.chunks) {
      const chunkTokens: (ThemedToken[] | undefined)[] = [];
      for (let i = 0; i < chunk.lines.length; i++) {
        chunkTokens.push(tokens[idx] ?? undefined);
        idx++;
      }
      result.push(chunkTokens);
    }
    return result;
  }, [ready, langVersion, file, shikiTheme, highlightLines]);

  const ChunkComponent = viewMode === "split" ? SplitDiffChunk : DiffChunk;

  return (
    <div
      id={`file-${encodeURIComponent(file.path)}`}
      className="border border-gh-border rounded-md mb-4 overflow-hidden"
    >
      {/* File header */}
      <div className="bg-gh-bg-secondary px-4 py-2 flex items-center gap-2 border-b border-gh-border sticky top-0 z-10">
        <span className={`font-bold text-sm ${meta.colorClass}`}>
          {meta.label}
        </span>
        <span className="font-mono text-sm text-gh-text-primary truncate">
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
      {file.isBinary ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          Binary file not shown
        </div>
      ) : file.chunks.length === 0 ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          No changes
        </div>
      ) : (
        <div className="overflow-x-auto">
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
              {file.chunks.map((chunk, i) => (
                <ChunkComponent
                  key={i}
                  chunk={chunk}
                  lineTokens={allLineTokens?.[i]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
