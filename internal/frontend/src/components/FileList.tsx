import type { DiffFile } from "../types";

interface FileListProps {
  files: DiffFile[];
}

const statusColor: Record<string, string> = {
  modified: "text-github-warning",
  added: "text-github-accent",
  deleted: "text-github-danger",
  renamed: "text-purple-400",
};

const statusLabel: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
};

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
      {/* Header */}
      <div className="px-3 py-2 border-b border-github-border text-sm text-github-text-secondary">
        <span className="font-semibold text-github-text-primary">
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

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => handleClick(file.path)}
            className="w-full text-left px-3 py-1.5 hover:bg-github-bg-tertiary flex items-center gap-2 group"
          >
            <span
              className={`text-xs font-bold shrink-0 w-4 text-center ${statusColor[file.status] ?? ""}`}
            >
              {statusLabel[file.status] ?? "?"}
            </span>
            <span className="font-mono text-xs text-github-text-secondary group-hover:text-github-text-primary truncate">
              {file.path}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
