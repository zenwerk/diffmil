import type { DiffFile } from "../types";
import { STATUS_META } from "../constants/status";

interface FileListProps {
  files: DiffFile[];
}

export function FileList({ files }: FileListProps) {
  const handleClick = (path: string) => {
    const el = document.getElementById(`file-${encodeURIComponent(path)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gh-border text-sm text-gh-text-secondary">
        <span className="font-semibold text-gh-text-primary">
          {files.length}
        </span>{" "}
        files changed
        {totalAdditions > 0 && (
          <span className="ml-2 text-green-400">+{totalAdditions}</span>
        )}
        {totalDeletions > 0 && (
          <span className="ml-1 text-red-400">-{totalDeletions}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const meta = STATUS_META[file.status] ?? STATUS_META.modified;
          return (
            <button
              key={file.path}
              onClick={() => handleClick(file.path)}
              className="w-full text-left px-3 py-1.5 hover:bg-gh-bg-tertiary flex items-center gap-2 group"
            >
              <span
                className={`text-xs font-bold shrink-0 w-4 text-center ${meta.colorClass}`}
              >
                {meta.label}
              </span>
              <span className="font-mono text-xs text-gh-text-secondary group-hover:text-gh-text-primary truncate">
                {file.path}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
