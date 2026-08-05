import type { ReactNode } from "react";
import type { DiffFile } from "../types";
import { FileHeader } from "./FileHeader";

interface FileCardProps {
  file: DiffFile;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  threadCount: number;
  children: ReactNode;
}

// FileCard is the chrome every file viewer shares: the anchor wrapper div
// (FileList navigation and Ctrl+j/k scroll to its id), the sticky FileHeader,
// and the collapsed / binary short-circuits. Keeping it in one place means the
// viewers only differ in the diff body they render, and the card's height
// stays in lockstep with the Virtualizer's estimates (FILE_HEADER_HEIGHT).
export function FileCard({
  file,
  collapsed,
  onToggleCollapsed,
  threadCount,
  children,
}: FileCardProps) {
  return (
    <div
      id={`file-${encodeURIComponent(file.path)}`}
      className="border border-gh-border rounded-md mb-4 overflow-hidden"
    >
      <FileHeader
        file={file}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        threadCount={threadCount}
      />
      {collapsed ? null : file.isBinary ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          Binary file not shown
        </div>
      ) : (
        children
      )}
    </div>
  );
}
