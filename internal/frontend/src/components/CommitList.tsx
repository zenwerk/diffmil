import type { Commit } from "../types";

interface CommitListProps {
  commits: Commit[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

export function CommitList({
  commits,
  selectedHash,
  onSelect,
}: CommitListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gh-border text-sm font-semibold text-gh-text-primary">
        Commits
        <span className="ml-1 text-gh-text-muted font-normal">
          ({commits.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {commits.map((commit) => {
          const isSelected = commit.hash === selectedHash;
          return (
            <button
              key={commit.hash}
              onClick={() => onSelect(commit.hash)}
              className={`w-full text-left px-3 py-2 border-b border-gh-border/50 hover:bg-gh-bg-tertiary transition-colors ${
                isSelected ? "bg-gh-bg-tertiary border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-gh-link shrink-0">
                  {commit.short}
                </span>
                <span className="text-xs text-gh-text-muted truncate">
                  {formatDate(commit.date)}
                </span>
              </div>
              <div className="text-sm text-gh-text-primary truncate mt-0.5">
                {commit.subject}
              </div>
              <div className="text-xs text-gh-text-muted truncate">
                {commit.author}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
