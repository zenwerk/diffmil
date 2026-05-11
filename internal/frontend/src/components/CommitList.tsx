import { PanelLeftClose, MessageSquare } from "lucide-react";
import type { Commit } from "../types";

interface CommitListProps {
  commits: Commit[];
  selectedHash: string | null;
  commitsWithComments?: Set<string>;
  onSelect: (hash: string) => void;
  onCollapse: () => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
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

function CommitEntry({
  commit,
  isSelected,
  hasComments,
  onSelect,
}: {
  commit: Commit;
  isSelected: boolean;
  hasComments: boolean;
  onSelect: () => void;
}) {
  const isWorking = commit.hash === "working";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 border-b border-gh-border/50 hover:bg-gh-bg-tertiary transition-colors ${
        isSelected
          ? "bg-gh-bg-tertiary border-l-2 border-l-blue-500"
          : "border-l-2 border-l-transparent"
      }`}
    >
      {isWorking ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-gh-warning shrink-0">
              *
            </span>
            <span className="text-sm font-semibold text-gh-warning">
              Uncommitted changes
            </span>
          </div>
          <div className="text-xs text-gh-text-muted mt-0.5">
            Working tree vs HEAD
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-gh-link shrink-0">
              {commit.short}
            </span>
            <span className="text-xs text-gh-text-muted truncate">
              {formatDate(commit.date)}
            </span>
            {commit.tags && commit.tags.length > 0 && (
              <span className="ml-auto flex flex-wrap gap-1 justify-end shrink-0 max-w-[55%]">
                {commit.tags.map((tag) => (
                  <span
                    key={tag}
                    title={tag}
                    className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 truncate max-w-full"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="text-sm text-gh-text-primary truncate mt-0.5 flex items-center gap-1.5">
            {hasComments && (
              <MessageSquare
                size={12}
                className="shrink-0 text-blue-400"
                aria-label="コメントあり"
              />
            )}
            <span className="truncate">{commit.subject}</span>
          </div>
          <div className="text-xs text-gh-text-muted truncate">
            {commit.author}
          </div>
        </>
      )}
    </button>
  );
}

export function CommitList({
  commits,
  selectedHash,
  commitsWithComments,
  onSelect,
  onCollapse,
}: CommitListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gh-border flex items-center">
        <span className="text-sm font-semibold text-gh-text-primary">
          Commits
        </span>
        <span className="ml-1 text-sm text-gh-text-muted font-normal">
          ({commits.length})
        </span>
        <button
          onClick={onCollapse}
          title="Hide commit history"
          className="ml-auto p-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {commits.map((commit) => (
          <CommitEntry
            key={commit.hash}
            commit={commit}
            isSelected={commit.hash === selectedHash}
            hasComments={commitsWithComments?.has(commit.hash) ?? false}
            onSelect={() => onSelect(commit.hash)}
          />
        ))}
      </div>
    </div>
  );
}
