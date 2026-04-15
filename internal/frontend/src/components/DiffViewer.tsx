import { useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { DiffFile } from "../types";
import { DiffChunk } from "./DiffChunk";
import { useHighlighter, detectLanguage } from "../hooks/useHighlighter";

interface DiffViewerProps {
  file: DiffFile;
  shikiTheme: string;
}

const statusBadge: Record<string, { label: string; className: string }> = {
  modified: { label: "M", className: "text-gh-warning" },
  added: { label: "A", className: "text-gh-accent" },
  deleted: { label: "D", className: "text-gh-danger" },
  renamed: { label: "R", className: "text-purple-400" },
};

export function DiffViewer({ file, shikiTheme }: DiffViewerProps) {
  const badge = statusBadge[file.status] ?? statusBadge.modified;
  const { ready, highlightLines } = useHighlighter();

  // Collect all line contents and highlight them in one shot
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
  }, [ready, file, shikiTheme, highlightLines]);

  return (
    <div
      id={`file-${encodeURIComponent(file.path)}`}
      className="border border-gh-border rounded-md mb-4 overflow-hidden"
    >
      {/* File header */}
      <div className="bg-gh-bg-secondary px-4 py-2 flex items-center gap-2 border-b border-gh-border sticky top-0 z-10">
        <span className={`font-bold text-sm ${badge.className}`}>
          {badge.label}
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
          <table className="w-full border-collapse">
            <tbody>
              {file.chunks.map((chunk, i) => (
                <DiffChunk
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
