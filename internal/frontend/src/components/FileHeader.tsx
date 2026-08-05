import { ChevronDown, ChevronRight } from "lucide-react";
import type { DiffFile } from "../types";
import { STATUS_META } from "../constants/status";
import { isAutoFoldPath } from "../constants/autoFold";

interface FileHeaderProps {
  file: DiffFile;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Number of comment threads on this file; renders a badge when > 0.
  threadCount: number;
}

// FILE_HEADER_HEIGHT is the rendered height of <FileHeader> in px: py-2
// (8 + 8) + text-sm line (20) + 1px bottom border. The Virtualizer uses it to
// estimate file placeholder sizes (see App's diffMetrics), so it lives next to
// the class list it is derived from — change the padding/border here and this
// constant together.
export const FILE_HEADER_HEIGHT = 37;

// FileHeader is the sticky bar above a file's diff body: collapse toggle,
// status letter, path (with rename arrow), comment badge and +/- counts.
// Shared by PierreDiffViewer and the RawDiffViewer fallback so both present
// identical chrome around differing diff bodies.
export function FileHeader({
  file,
  collapsed,
  onToggleCollapsed,
  threadCount,
}: FileHeaderProps) {
  const meta = STATUS_META[file.status] ?? STATUS_META.modified;
  const autoFold = isAutoFoldPath(file.path);

  return (
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
      {threadCount > 0 && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
          💬 {threadCount}
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
  );
}
