import { memo, useCallback } from "react";
import type { CommentThread, DiffFile } from "../types";
import { FileCard } from "./FileCard";

interface RawDiffViewerProps {
  file: DiffFile;
  collapsed: boolean;
  // Receives the file path so App can pass one stable callback to every
  // viewer; see PierreDiffViewer for the memo() rationale.
  onToggleCollapsed: (path: string) => void;
  threads: CommentThread[];
}

const LINE_PREFIX: Record<string, string> = {
  add: "+",
  delete: "-",
  normal: " ",
};

const LINE_CLASS: Record<string, string> = {
  add: "bg-diff-addition-bg",
  delete: "bg-diff-deletion-bg",
};

// RawDiffViewer is the safety net for files @pierre/diffs cannot render: a
// response without a `patch` field (a cached payload predating it), or a path
// the patch parse did not account for. It renders the Go-parsed `chunks` as
// plain monospace text — no highlighting, no comments, no context expansion —
// so a diff never silently shows nothing.
export const RawDiffViewer = memo(function RawDiffViewer({
  file,
  collapsed,
  onToggleCollapsed,
  threads,
}: RawDiffViewerProps) {
  const toggleCollapsed = useCallback(
    () => onToggleCollapsed(file.path),
    [onToggleCollapsed, file.path],
  );

  return (
    <FileCard
      file={file}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      threadCount={threads.length}
    >
      {file.chunks.length === 0 ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          No content to display
        </div>
      ) : (
        <div className="overflow-x-auto">
          <pre className="font-mono leading-[1.5] whitespace-pre text-gh-text-primary">
            {file.chunks.map((chunk, ci) => (
              <div key={ci}>
                <div className="text-gh-text-muted bg-gh-bg-tertiary px-4">
                  {chunk.header}
                </div>
                {chunk.lines.map((line, li) => (
                  <div key={li} className={`px-4 ${LINE_CLASS[line.type] ?? ""}`}>
                    {(LINE_PREFIX[line.type] ?? " ") + line.content}
                  </div>
                ))}
              </div>
            ))}
          </pre>
        </div>
      )}
    </FileCard>
  );
});
