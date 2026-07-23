import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  PanelLeft,
  PanelRight,
  FoldVertical,
  UnfoldVertical,
  ClipboardCopy,
  ClipboardList,
  Trash2,
  GitBranch,
} from "lucide-react";
import type { CommentThread, DiffResponse, Commit, DiffViewMode } from "./types";
import { CommitList } from "./components/CommitList";
import { FileList } from "./components/FileList";
import { DiffViewer } from "./components/DiffViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ShikiThemePicker } from "./components/ShikiThemePicker";
import { MonoFontPicker } from "./components/MonoFontPicker";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { Toast } from "./components/Toast";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { HighlighterProvider } from "./hooks/useHighlighter";
import { useTheme, ThemeProvider } from "./hooks/useTheme";
import { usePanelResize } from "./hooks/usePanelResize";
import { isAutoFoldPath } from "./constants/autoFold";
import { loadFromStorage, saveToStorage } from "./utils/storage";
import {
  useComments,
  listCommitsWithComments,
  loadAllWorkspaceThreads,
  countWorkspaceThreads,
  clearAllWorkspaceComments,
  pruneOrphanWorkspaceComments,
} from "./hooks/useComments";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { copyToClipboard, formatAllThreadsPrompt, toCommitContext } from "./utils/commentPrompt";

const EMPTY_THREADS: CommentThread[] = [];

const VIEW_MODE_KEY = "diffmil.viewMode";
const COMMITS_PANEL_KEY = "diffmil.commitsPanelOpen";
const FILES_PANEL_KEY = "diffmil.filesPanelOpen";
const DIFF_FONT_SIZE_KEY = "diffmil.diffFontSize";
const DIFF_FONT_SIZE_DEFAULT = 14;
const DIFF_FONT_SIZE_MIN = 10;
const DIFF_FONT_SIZE_MAX = 20;

const loadDiffFontSize = () =>
  loadFromStorage(
    DIFF_FONT_SIZE_KEY,
    (s) => {
      const n = parseInt(s, 10);
      return !isNaN(n) && n >= DIFF_FONT_SIZE_MIN && n <= DIFF_FONT_SIZE_MAX
        ? n
        : undefined;
    },
    DIFF_FONT_SIZE_DEFAULT,
  );

const loadViewMode = () =>
  loadFromStorage<DiffViewMode>(
    VIEW_MODE_KEY,
    (s) => (s === "unified" || s === "split" ? s : undefined),
    "unified",
  );

const loadBoolPanel = (key: string) =>
  loadFromStorage<boolean>(
    key,
    (s) => (s === "false" ? false : s === "true" ? true : undefined),
    true,
  );

function AppContent() {
  const {
    workspaces,
    activeId,
    setActiveId,
    refresh: refreshWorkspaces,
    removeWorkspace,
    renameWorkspace,
  } = useWorkspaces();
  const wsId = activeId;
  const wsParam = wsId ? `?ws=${encodeURIComponent(wsId)}` : "";

  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branch, setBranch] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<DiffViewMode>(loadViewMode);
  const [commitsPanelOpen, setCommitsPanelOpenState] = useState(() => loadBoolPanel(COMMITS_PANEL_KEY));
  const [filesPanelOpen, setFilesPanelOpenState] = useState(() => loadBoolPanel(FILES_PANEL_KEY));
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [diffFontSize, setDiffFontSizeState] = useState(loadDiffFontSize);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const toggleFileCollapsed = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAllFiles = useCallback(() => {
    setCollapsedFiles(new Set((diffData?.files ?? []).map((f) => f.path)));
  }, [diffData]);

  const expandAllFiles = useCallback(() => {
    setCollapsedFiles(new Set());
  }, []);

  const { threads, addThread, updateMessage, removeThread, clearAll } = useComments(wsId, selectedCommit);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmClearWs, setConfirmClearWs] = useState(false);
  // Reset the "are you sure" confirmation states whenever the commit or
  // workspace switches so they don't bleed across contexts.
  useEffect(() => {
    setConfirmClearAll(false);
  }, [selectedCommit, wsId]);
  useEffect(() => {
    setConfirmClearWs(false);
  }, [wsId]);

  const [commitsWithComments, setCommitsWithComments] = useState<Set<string>>(() =>
    listCommitsWithComments(wsId),
  );
  useEffect(() => {
    setCommitsWithComments(listCommitsWithComments(wsId));
  }, [threads, selectedCommit, wsId]);
  // Derived from storage; commitsWithComments is included in deps so it
  // refreshes after bulk operations (clear / prune) update the set.
  const wsThreadCount = useMemo(
    () => countWorkspaceThreads(wsId),
    [wsId, threads, commitsWithComments],
  );

  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    for (const t of threads) {
      const arr = map.get(t.filePath) ?? [];
      arr.push(t);
      map.set(t.filePath, arr);
    }
    return map;
  }, [threads]);

  const handleCommentCopied = useCallback(() => {
    setToastMessage("プロンプトをコピーしました");
  }, []);

  const handleCopyAllPrompts = useCallback(
    async (ctx: ReturnType<typeof toCommitContext> | undefined) => {
      if (threads.length === 0) return;
      const ok = await copyToClipboard(formatAllThreadsPrompt(threads, ctx));
      if (ok) {
        setToastMessage(`${threads.length}件のコメントをコピーしました`);
      }
    },
    [threads],
  );

  // Stable ref so handleCopyWorkspacePrompts doesn't need `commits` in its deps.
  const commitsRef = useRef(commits);
  useEffect(() => {
    commitsRef.current = commits;
  }, [commits]);

  const handleCopyWorkspacePrompts = useCallback(async () => {
    const byCommit = loadAllWorkspaceThreads(wsId);
    if (byCommit.size === 0) return;
    // Emit blocks in current commit-list order so the LLM sees commits
    // newest-first; orphans (no longer in the list) trail at the end.
    const knownOrder = new Map<string, number>();
    commitsRef.current.forEach((c, i) => knownOrder.set(c.hash, i));
    const orderedHashes = Array.from(byCommit.keys()).sort((a, b) => {
      const ai = knownOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = knownOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });

    const blocks: string[] = [];
    let totalThreads = 0;
    for (const hash of orderedHashes) {
      const arr = byCommit.get(hash) ?? [];
      if (arr.length === 0) continue;
      const commit = commitsRef.current.find((c) => c.hash === hash) ?? null;
      const ctx = toCommitContext(commit, hash);
      blocks.push(formatAllThreadsPrompt(arr, ctx));
      totalThreads += arr.length;
    }
    if (totalThreads === 0) return;
    const ok = await copyToClipboard(blocks.join("\n=====\n"));
    if (ok) {
      setToastMessage(
        `${totalThreads}件のコメント (${orderedHashes.length}コミット) をコピーしました`,
      );
    }
  }, [wsId]);

  const handleClearWorkspaceComments = useCallback(() => {
    const removed = clearAllWorkspaceComments(wsId);
    setCommitsWithComments(listCommitsWithComments(wsId));
    // clearAll also wipes the in-memory threads for the currently-selected
    // commit so the UI matches now-empty storage.
    clearAll();
    setConfirmClearWs(false);
    setToastMessage(`${removed}件のコメントを削除しました`);
  }, [wsId, clearAll]);

  useEffect(() => {
    const auto = new Set<string>();
    for (const f of diffData?.files ?? []) {
      if (isAutoFoldPath(f.path)) auto.add(f.path);
    }
    setCollapsedFiles(auto);
  }, [diffData]);

  const mainRef = useRef<HTMLElement | null>(null);
  const lastEscRef = useRef(0);
  const diffDataRef = useRef(diffData);
  const collapsedFilesRef = useRef(collapsedFiles);
  const viewModeRef = useRef(viewMode);
  const shortcutsHelpOpenRef = useRef(shortcutsHelpOpen);
  useEffect(() => { diffDataRef.current = diffData; }, [diffData]);
  useEffect(() => { collapsedFilesRef.current = collapsedFiles; }, [collapsedFiles]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { shortcutsHelpOpenRef.current = shortcutsHelpOpen; }, [shortcutsHelpOpen]);

  const setCommitsPanelOpen = useCallback((next: boolean) => {
    setCommitsPanelOpenState(next);
    saveToStorage(COMMITS_PANEL_KEY, String(next));
  }, []);

  const setFilesPanelOpen = useCallback((next: boolean) => {
    setFilesPanelOpenState(next);
    saveToStorage(FILES_PANEL_KEY, String(next));
  }, []);

  const focusDiffArea = useCallback(() => {
    setCommitsPanelOpen(false);
    setFilesPanelOpen(false);
    mainRef.current?.focus();
  }, [setCommitsPanelOpen, setFilesPanelOpen]);

  const changeDiffFontSize = useCallback((delta: number) => {
    setDiffFontSizeState((prev) => {
      const next = Math.min(DIFF_FONT_SIZE_MAX, Math.max(DIFF_FONT_SIZE_MIN, prev + delta));
      saveToStorage(DIFF_FONT_SIZE_KEY, String(next));
      return next;
    });
  }, []);
  const { shikiTheme } = useTheme();
  const commitPanel = usePanelResize("diffmil.commitsPanelWidth", 300, 160, 600, "right");
  const filePanel = usePanelResize("diffmil.filesPanelWidth", 240, 140, 500, "left");

  const setViewMode = useCallback((mode: DiffViewMode) => {
    setViewModeState(mode);
    saveToStorage(VIEW_MODE_KEY, mode);
  }, []);

  const toggleCommitsPanel = useCallback(() => {
    setCommitsPanelOpenState((prev) => {
      const next = !prev;
      saveToStorage(COMMITS_PANEL_KEY, String(next));
      return next;
    });
  }, []);

  const toggleFilesPanel = useCallback(() => {
    setFilesPanelOpenState((prev) => {
      const next = !prev;
      saveToStorage(FILES_PANEL_KEY, String(next));
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
        const files = diffDataRef.current?.files ?? [];
        if (files.length === 0) return;
        const collapsed = collapsedFilesRef.current;
        const visibleIdx: number[] = [];
        const ids: string[] = [];
        for (let i = 0; i < files.length; i++) {
          ids.push(`file-${encodeURIComponent(files[i].path)}`);
          if (!collapsed.has(files[i].path)) visibleIdx.push(i);
        }
        if (visibleIdx.length === 0) return;
        const current = ids.findIndex((id) => {
          const el = document.getElementById(id);
          if (!el) return false;
          return el.getBoundingClientRect().top >= -1;
        });
        let target: number;
        if (e.key === "j") {
          const nextVisible = visibleIdx.find((i) => i > (current === -1 ? -1 : current));
          target = nextVisible ?? visibleIdx[visibleIdx.length - 1];
        } else {
          const prevVisible = [...visibleIdx].reverse().find((i) => i < (current === -1 ? files.length : current));
          target = prevVisible ?? visibleIdx[0];
        }
        document.getElementById(ids[target])?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setViewMode(viewModeRef.current === "unified" ? "split" : "unified");
      } else if (e.ctrlKey && e.key === "=") {
        e.preventDefault();
        changeDiffFontSize(1);
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        changeDiffFontSize(-1);
      } else if (e.key === "Escape" && !shortcutsHelpOpenRef.current) {
        const now = Date.now();
        if (now - lastEscRef.current < 500) {
          e.preventDefault();
          focusDiffArea();
          lastEscRef.current = 0;
        } else {
          lastEscRef.current = now;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommitsPanel, toggleFilesPanel, setViewMode, changeDiffFontSize, focusDiffArea]);

  const fetchCommits = useCallback(
    () =>
      fetch("/_/api/commits" + wsParam)
        .then((res) => {
          if (!res.ok) return [] as Commit[];
          return res.json() as Promise<Commit[]>;
        })
        .catch(() => [] as Commit[]),
    [wsParam],
  );

  const fetchBranch = useCallback(
    () =>
      fetch("/_/api/branch" + wsParam)
        .then((res) => {
          if (!res.ok) return { branch: "" };
          return res.json() as Promise<{ branch: string }>;
        })
        .then((data) => setBranch(data.branch ?? ""))
        .catch(() => setBranch("")),
    [wsParam],
  );

  // Used by applyCommits to drop results from a workspace the user already
  // switched away from.
  const activeWsIdRef = useRef(wsId);
  useEffect(() => {
    activeWsIdRef.current = wsId;
  }, [wsId]);

  // Applies a freshly-fetched commit list and prunes orphan comments. Skips
  // pruning when the list is empty (could be transient fetch failure) or
  // belongs to a workspace the user already switched away from.
  const applyCommits = useCallback((wsForList: string | null, list: Commit[]) => {
    setCommits(list);
    if (wsForList !== activeWsIdRef.current) return;
    if (list.length === 0) return;
    const keep = new Set(list.map((c) => c.hash));
    const removed = pruneOrphanWorkspaceComments(wsForList, keep);
    setSelectedCommit((prev) => (prev && !keep.has(prev) ? null : prev));
    if (removed > 0) {
      setCommitsWithComments(listCommitsWithComments(wsForList));
      setToastMessage(`履歴に存在しないコミットのコメント${removed}件を削除しました`);
    }
  }, []);

  const dismissToast = useCallback(() => setToastMessage(null), []);

  useEffect(() => {
    // Wait until a workspace is selected before issuing scoped fetches.
    if (workspaces.length > 0 && !wsId) return;
    setLoading(true);
    Promise.all([
      fetch("/_/api/diff" + wsParam).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DiffResponse>;
      }),
      fetchCommits(),
      fetchBranch(),
    ])
      .then(([diff, commitList]) => {
        setDiffData(diff);
        applyCommits(wsId, commitList);
        setSelectedCommit(null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [fetchCommits, fetchBranch, wsParam, wsId, workspaces.length, applyCommits]);

  // Refs so the long-lived SSE listener always sees the current active workspace
  // without forcing the EventSource to reconnect on every workspace switch.
  const wsIdSseRef = useRef(wsId);
  const wsParamSseRef = useRef(wsParam);
  const fetchCommitsRef = useRef(fetchCommits);
  const fetchBranchRef = useRef(fetchBranch);
  useEffect(() => {
    wsIdSseRef.current = wsId;
    wsParamSseRef.current = wsParam;
    fetchCommitsRef.current = fetchCommits;
    fetchBranchRef.current = fetchBranch;
  }, [wsId, wsParam, fetchCommits, fetchBranch]);

  useEffect(() => {
    const es = new EventSource("/_/events");

    // A payload without a workspaceId is treated as relevant to all (legacy/broadcast).
    const isRelevant = (data: string): boolean => {
      try {
        const parsed = JSON.parse(data || "{}");
        const eventWs = parsed.workspaceId;
        if (!eventWs) return true;
        return eventWs === wsIdSseRef.current;
      } catch {
        return true;
      }
    };

    es.addEventListener("update", (e) => {
      if (!isRelevant((e as MessageEvent).data)) return;
      fetch("/_/api/diff" + wsParamSseRef.current)
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

    es.addEventListener("commits-changed", (e) => {
      if (!isRelevant((e as MessageEvent).data)) return;
      const wsAtFetch = wsIdSseRef.current;
      void fetchBranchRef.current();
      fetchCommitsRef.current().then((commitList) => {
        applyCommits(wsAtFetch, commitList);
        setToastMessage("New commits detected");
      });
    });

    es.addEventListener("workspaces-changed", () => {
      refreshWorkspaces();
    });

    es.onerror = () => {};

    return () => es.close();
  }, [refreshWorkspaces, applyCommits]);

  const handleSelectCommit = useCallback(
    (hash: string) => {
      setSelectedCommit(hash);
      setDiffLoading(true);
      const params = new URLSearchParams();
      if (wsId) params.set("ws", wsId);
      params.set("commit", hash);
      fetch(`/_/api/diff?${params.toString()}`)
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
    },
    [wsId],
  );

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
  const commitContext = selectedCommit
    ? toCommitContext(selectedCommitInfo, selectedCommit)
    : undefined;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-gh-bg-secondary border-b border-gh-border px-4 py-2 flex items-center gap-3 shrink-0 min-w-0">
        <h1 className="text-sm font-semibold text-gh-text-primary shrink-0">
          diffmil
        </h1>
        <WorkspacePicker
          workspaces={workspaces}
          activeId={activeId}
          onSelect={setActiveId}
          onRemove={(id) => {
            void removeWorkspace(id);
          }}
          onRename={(id, label) => {
            void renameWorkspace(id, label);
          }}
        />
        {branch && (
          <span
            title={`現在のブランチ: ${branch}`}
            className="flex items-center gap-1 font-mono text-xs text-gh-text-muted shrink-0 max-w-[200px]"
          >
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        )}
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
          {threads.length > 0 && (
            <>
              <button
                onClick={() => handleCopyAllPrompts(commitContext)}
                title={`このコミットの全コメント(${threads.length}件)をプロンプト形式でコピー`}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
              >
                <ClipboardCopy size={14} />
                <span className="font-mono">{threads.length}</span>
              </button>
              {confirmClearAll ? (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-gh-warning">
                    このコミットの{threads.length}件を削除？
                  </span>
                  <button
                    onClick={() => {
                      clearAll();
                      setConfirmClearAll(false);
                      setToastMessage(`${threads.length}件のコメントを削除しました`);
                    }}
                    className="px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2 py-1 rounded text-gh-text-secondary hover:bg-gh-bg-tertiary transition-colors"
                  >
                    キャンセル
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClearAll(true)}
                  title={`このコミットの全コメント(${threads.length}件)を削除`}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gh-text-muted border border-gh-border hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
          {wsThreadCount > 0 && (
            <>
              <span className="h-4 w-px bg-gh-border" aria-hidden />
              <button
                onClick={() => void handleCopyWorkspacePrompts()}
                title={`ワークスペース全体の全コメント(${wsThreadCount}件)をプロンプト形式でコピー`}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
              >
                <ClipboardList size={14} />
                <span className="font-mono">{wsThreadCount}</span>
              </button>
              {confirmClearWs ? (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-gh-warning">
                    ワークスペース全体の{wsThreadCount}件を削除？
                  </span>
                  <button
                    onClick={handleClearWorkspaceComments}
                    className="px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setConfirmClearWs(false)}
                    className="px-2 py-1 rounded text-gh-text-secondary hover:bg-gh-bg-tertiary transition-colors"
                  >
                    キャンセル
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClearWs(true)}
                  title={`ワークスペース全体の全コメント(${wsThreadCount}件)を削除`}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gh-text-muted border border-gh-border hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
          {files.length > 0 && (
            <>
              <button
                onClick={collapseAllFiles}
                title="全ファイルを折りたたむ"
                className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
              >
                <FoldVertical size={16} />
              </button>
              <button
                onClick={expandAllFiles}
                title="全ファイルを展開"
                className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
              >
                <UnfoldVertical size={16} />
              </button>
            </>
          )}
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <MonoFontPicker />
          <ShikiThemePicker />
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
                  commitsWithComments={commitsWithComments}
                  onSelect={handleSelectCommit}
                  onCollapse={toggleCommitsPanel}
                />
              </div>
              <div
                className="absolute -right-2 top-0 bottom-0 w-4 cursor-col-resize z-10 group/handle"
                onMouseDown={commitPanel.onMouseDown}
              >
                <div className="absolute right-2 top-0 bottom-0 w-1 group-hover/handle:bg-blue-500/40 group-active/handle:bg-blue-500/60 transition-colors" />
              </div>
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

        <main
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 outline-none"
          style={{ fontSize: diffFontSize }}
        >
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
                collapsed={collapsedFiles.has(file.path)}
                onToggleCollapsed={() => toggleFileCollapsed(file.path)}
                threads={threadsByFile.get(file.path) ?? EMPTY_THREADS}
                commitContext={commitContext}
                onAddComment={addThread}
                onUpdateComment={updateMessage}
                onRemoveComment={removeThread}
                onCommentCopied={handleCommentCopied}
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
                className="absolute -left-2 top-0 bottom-0 w-4 cursor-col-resize z-10 group/handle"
                onMouseDown={filePanel.onMouseDown}
              >
                <div className="absolute left-2 top-0 bottom-0 w-1 group-hover/handle:bg-blue-500/40 group-active/handle:bg-blue-500/60 transition-colors" />
              </div>
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
