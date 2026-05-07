import { useState, useEffect, useCallback } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import type { DiffResponse, Commit, DiffViewMode } from "./types";
import { CommitList } from "./components/CommitList";
import { FileList } from "./components/FileList";
import { DiffViewer } from "./components/DiffViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { Toast } from "./components/Toast";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { HighlighterProvider } from "./hooks/useHighlighter";
import { useTheme, ThemeProvider } from "./hooks/useTheme";
import { usePanelResize } from "./hooks/usePanelResize";

const VIEW_MODE_KEY = "diffmil.viewMode";
const COMMITS_PANEL_KEY = "diffmil.commitsPanelOpen";
const FILES_PANEL_KEY = "diffmil.filesPanelOpen";
const DIFF_FONT_SIZE_KEY = "diffmil.diffFontSize";
const DIFF_FONT_SIZE_DEFAULT = 14;
const DIFF_FONT_SIZE_MIN = 10;
const DIFF_FONT_SIZE_MAX = 20;

function loadDiffFontSize(): number {
  try {
    const stored = localStorage.getItem(DIFF_FONT_SIZE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (!isNaN(n) && n >= DIFF_FONT_SIZE_MIN && n <= DIFF_FONT_SIZE_MAX) return n;
    }
  } catch {
    // ignore
  }
  return DIFF_FONT_SIZE_DEFAULT;
}

function loadViewMode(): DiffViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "unified" || stored === "split") return stored;
  } catch {
    // ignore
  }
  return "unified";
}

function loadCommitsPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(COMMITS_PANEL_KEY);
    if (stored === "false") return false;
  } catch {
    // ignore
  }
  return true;
}

function loadFilesPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(FILES_PANEL_KEY);
    if (stored === "false") return false;
  } catch {
    // ignore
  }
  return true;
}

function AppContent() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<DiffViewMode>(loadViewMode);
  const [commitsPanelOpen, setCommitsPanelOpenState] = useState(loadCommitsPanelOpen);
  const [filesPanelOpen, setFilesPanelOpenState] = useState(loadFilesPanelOpen);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [diffFontSize, setDiffFontSizeState] = useState(loadDiffFontSize);

  const changeDiffFontSize = useCallback((delta: number) => {
    setDiffFontSizeState((prev) => {
      const next = Math.min(DIFF_FONT_SIZE_MAX, Math.max(DIFF_FONT_SIZE_MIN, prev + delta));
      localStorage.setItem(DIFF_FONT_SIZE_KEY, String(next));
      return next;
    });
  }, []);
  const { shikiTheme } = useTheme();
  const commitPanel = usePanelResize("diffmil.commitsPanelWidth", 300, 160, 600, "right");
  const filePanel = usePanelResize("diffmil.filesPanelWidth", 240, 140, 500, "left");

  const setViewMode = useCallback((mode: DiffViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);

  const toggleCommitsPanel = useCallback(() => {
    setCommitsPanelOpenState((prev) => {
      const next = !prev;
      localStorage.setItem(COMMITS_PANEL_KEY, String(next));
      return next;
    });
  }, []);

  const toggleFilesPanel = useCallback(() => {
    setFilesPanelOpenState((prev) => {
      const next = !prev;
      localStorage.setItem(FILES_PANEL_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "[") {
        e.preventDefault();
        toggleCommitsPanel();
      } else if (e.ctrlKey && e.key === "]") {
        e.preventDefault();
        toggleFilesPanel();
      } else if (e.ctrlKey && (e.key === "j" || e.key === "k")) {
        e.preventDefault();
        const files = diffData?.files ?? [];
        if (files.length === 0) return;
        const ids = files.map((f) => `file-${encodeURIComponent(f.path)}`);
        const current = ids.findIndex((id) => {
          const el = document.getElementById(id);
          if (!el) return false;
          return el.getBoundingClientRect().top >= -1;
        });
        let next: number;
        if (e.key === "j") {
          next = current === -1 ? 0 : Math.min(current + 1, ids.length - 1);
        } else {
          next = current <= 0 ? 0 : current - 1;
        }
        document.getElementById(ids[next])?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setViewMode(viewMode === "unified" ? "split" : "unified");
      } else if (e.ctrlKey && e.key === "=") {
        e.preventDefault();
        changeDiffFontSize(1);
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        changeDiffFontSize(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommitsPanel, toggleFilesPanel, diffData, viewMode, setViewMode, changeDiffFontSize]);

  const fetchCommits = useCallback(
    () =>
      fetch("/_/api/commits")
        .then((res) => {
          if (!res.ok) return [] as Commit[];
          return res.json() as Promise<Commit[]>;
        })
        .catch(() => [] as Commit[]),
    [],
  );

  const dismissToast = useCallback(() => setToastMessage(null), []);

  useEffect(() => {
    Promise.all([
      fetch("/_/api/diff").then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DiffResponse>;
      }),
      fetchCommits(),
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
  }, [fetchCommits]);

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

    es.addEventListener("commits-changed", () => {
      fetchCommits().then((commitList) => {
        setCommits(commitList);
        setToastMessage("New commits detected");
      });
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
  const selectedCommitInfo = selectedCommit
    ? commits.find((c) => c.hash === selectedCommit) ?? null
    : null;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-gh-bg-secondary border-b border-gh-border px-4 py-2 flex items-center gap-3 shrink-0 min-w-0">
        <h1 className="text-sm font-semibold text-gh-text-primary shrink-0">
          diffmil
        </h1>
        {selectedCommitInfo && (
          <div className="flex items-center gap-2 min-w-0 group relative">
            <span className="font-mono text-xs text-gh-text-muted shrink-0">
              {selectedCommitInfo.short}
            </span>
            <span className="text-xs text-gh-text-primary truncate">
              {selectedCommitInfo.subject}
            </span>
            <span className="text-xs text-gh-text-muted shrink-0 hidden sm:block truncate max-w-[160px]">
              {selectedCommitInfo.author}
            </span>
            {/* hover tooltip */}
            <div className="pointer-events-none absolute left-0 top-full mt-1 z-50 hidden group-hover:block">
              <div className="bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl p-3 text-xs space-y-1 w-max max-w-sm">
                <div className="font-mono text-gh-link">{selectedCommitInfo.hash}</div>
                <div className="text-gh-text-primary font-medium">{selectedCommitInfo.subject}</div>
                <div className="text-gh-text-muted">{selectedCommitInfo.author}</div>
                <div className="text-gh-text-muted">{new Date(selectedCommitInfo.date).toLocaleString()}</div>
              </div>
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <ThemeToggle />
          <button
            onClick={() => setShortcutsHelpOpen(true)}
            title="キーボードショートカット"
            className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors text-sm font-semibold leading-none"
          >
            ?
          </button>
        </div>
      </header>
      {shortcutsHelpOpen && (
        <KeyboardShortcutsHelp onClose={() => setShortcutsHelpOpen(false)} />
      )}

      <div className="flex flex-1 overflow-hidden">
        {hasCommits && (
          commitsPanelOpen ? (
            <aside
              className="shrink-0 border-r border-gh-border bg-gh-bg-secondary overflow-hidden relative flex"
              style={{ width: commitPanel.width }}
            >
              <div className="flex-1 overflow-hidden">
                <CommitList
                  commits={commits}
                  selectedHash={selectedCommit}
                  onSelect={handleSelectCommit}
                  onCollapse={toggleCommitsPanel}
                />
              </div>
              <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors z-10"
                onMouseDown={commitPanel.onMouseDown}
              />
            </aside>
          ) : (
            <div className="shrink-0 border-r border-gh-border bg-gh-bg-secondary flex items-start pt-2 px-1">
              <button
                onClick={toggleCommitsPanel}
                title="Show commit history"
                className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
              >
                <PanelLeft size={16} />
              </button>
            </div>
          )
        )}

        <main className="flex-1 overflow-y-auto p-4" style={{ fontSize: diffFontSize }}>
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

        {files.length > 0 && (
          filesPanelOpen ? (
            <aside
              className="shrink-0 border-l border-gh-border bg-gh-bg-secondary overflow-hidden relative flex"
              style={{ width: filePanel.width }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors z-10"
                onMouseDown={filePanel.onMouseDown}
              />
              <div className="flex-1 overflow-hidden">
                <FileList files={files} onCollapse={toggleFilesPanel} />
              </div>
            </aside>
          ) : (
            <div className="shrink-0 border-l border-gh-border bg-gh-bg-secondary flex items-start pt-2 px-1">
              <button
                onClick={toggleFilesPanel}
                title="Show file list"
                className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
              >
                <PanelRight size={16} />
              </button>
            </div>
          )
        )}
      </div>

      <Toast
        message={toastMessage ?? ""}
        visible={toastMessage !== null}
        onDismiss={dismissToast}
      />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <HighlighterProvider>
        <AppContent />
      </HighlighterProvider>
    </ThemeProvider>
  );
}
