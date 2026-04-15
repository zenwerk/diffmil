import { useState, useEffect, useCallback } from "react";
import type { DiffResponse, Commit, DiffViewMode } from "./types";
import { CommitList } from "./components/CommitList";
import { FileList } from "./components/FileList";
import { DiffViewer } from "./components/DiffViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { HighlighterProvider } from "./hooks/useHighlighter";
import { useTheme } from "./hooks/useTheme";

const VIEW_MODE_KEY = "diffmil.viewMode";

function loadViewMode(): DiffViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "unified" || stored === "split") return stored;
  } catch {
    // ignore
  }
  return "unified";
}

function AppContent() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<DiffViewMode>(loadViewMode);
  const { shikiTheme } = useTheme();

  const setViewMode = useCallback((mode: DiffViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/_/api/diff").then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DiffResponse>;
      }),
      fetch("/_/api/commits")
        .then((res) => {
          if (!res.ok) return [] as Commit[];
          return res.json() as Promise<Commit[]>;
        })
        .catch(() => [] as Commit[]),
    ])
      .then(([diff, commitList]) => {
        setDiffData(diff);
        setCommits(commitList);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const es = new EventSource("/_/events");

    es.addEventListener("update", () => {
      fetch("/_/api/diff")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<DiffResponse>;
        })
        .then((data) => {
          setDiffData(data);
          setSelectedCommit(null);
        })
        .catch(() => {});
    });

    es.onerror = () => {};

    return () => es.close();
  }, []);

  const handleSelectCommit = useCallback((hash: string) => {
    setSelectedCommit(hash);
    setDiffLoading(true);
    fetch(`/_/api/diff?commit=${encodeURIComponent(hash)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DiffResponse>;
      })
      .then((data) => {
        setDiffData(data);
        setDiffLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setDiffLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-gh-text-muted">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center text-gh-danger">
        Error: {error}
      </div>
    );
  }

  const files = diffData?.files ?? [];
  const hasCommits = commits.length > 0;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-gh-bg-secondary border-b border-gh-border px-4 py-2 flex items-center gap-3 shrink-0">
        <h1 className="text-sm font-semibold text-gh-text-primary">
          diffmil
        </h1>
        {selectedCommit && (
          <span className="font-mono text-xs text-gh-text-muted">
            {selectedCommit.slice(0, 7)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {hasCommits && (
          <aside className="w-[300px] shrink-0 border-r border-gh-border bg-gh-bg-secondary overflow-hidden">
            <CommitList
              commits={commits}
              selectedHash={selectedCommit}
              onSelect={handleSelectCommit}
            />
          </aside>
        )}

        {files.length > 0 && (
          <aside className="w-[240px] shrink-0 border-r border-gh-border bg-gh-bg-secondary overflow-hidden">
            <FileList files={files} />
          </aside>
        )}

        <main className="flex-1 overflow-y-auto p-4">
          {diffLoading ? (
            <div className="flex items-center justify-center h-full text-gh-text-muted">
              Loading diff...
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gh-text-muted">
              {hasCommits
                ? "Select a commit to view its diff"
                : "No changes to display"}
            </div>
          ) : (
            files.map((file) => (
              <DiffViewer
                key={file.path}
                file={file}
                shikiTheme={shikiTheme}
                viewMode={viewMode}
              />
            ))
          )}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HighlighterProvider>
      <AppContent />
    </HighlighterProvider>
  );
}
