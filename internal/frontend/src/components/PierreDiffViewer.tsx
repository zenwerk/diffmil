import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FileDiff, useStableCallback, type FileDiffMetadata } from "@pierre/diffs/react";
import type {
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
  VirtualFileMetrics,
} from "@pierre/diffs";
import type {
  CommentThread,
  DiffFile,
  DiffSide,
  DiffViewMode,
} from "../types";
import { FileCard } from "./FileCard";
import { CommentCard } from "./CommentCard";
import { CommentForm } from "./CommentForm";
import { useTheme } from "../hooks/useTheme";
import type { CommitContext } from "../utils/commentPrompt";
import { collectRangeSnapshot } from "../utils/diffLine";
import { buildDiffFilesLoader } from "../utils/pierreLoader";
import {
  buildAnnotations,
  buildSelectedLines,
  clampRangeToPatch,
  hasLineOnSide,
  toDiffSide,
  type AnnotationMeta,
  type PendingForm,
} from "../utils/pierreAnnotations";

interface PierreDiffViewerProps {
  file: DiffFile;
  // Parsed @pierre/diffs metadata for this file. Must be a stable reference
  // across renders: the renderer mutates it in place when hydrating context,
  // so re-parsing per render would discard that state.
  fileDiff: FileDiffMetadata;
  // Height estimates the Virtualizer uses to size the placeholder before the
  // file is rendered and measured. Must track diffmil's actual typography (see
  // App's `diffMetrics`) or scroll position drifts as files hydrate.
  metrics: VirtualFileMetrics;
  viewMode: DiffViewMode;
  collapsed: boolean;
  // Receives the file path so App can pass one stable callback to every
  // viewer, which is what lets the memo() wrapper below actually skip renders.
  onToggleCollapsed: (path: string) => void;
  threads: CommentThread[];
  commitContext?: CommitContext;
  workspaceId?: string;
  onAddComment: (params: {
    filePath: string;
    side: DiffSide;
    line: number;
    endLine?: number;
    body: string;
    codeSnapshot: string;
  }) => void;
  onUpdateComment: (threadId: string, messageId: string, body: string) => void;
  onRemoveComment: (threadId: string) => void;
  onCommentCopied?: () => void;
}

// PierreDiffViewer renders a single file's diff with @pierre/diffs inside the
// shared FileCard chrome.
//
// Context expansion goes through `loadDiffFiles` (see pierreLoader.ts).
// Comments ride the library's annotation and selection APIs: threads and the
// open comment form become `lineAnnotations` projected into light-DOM slots
// (so the existing Tailwind CommentCard/CommentForm render unchanged), and
// range selection is the library's built-in drag/Shift+click handling.
// Under App's <Virtualizer> the <FileDiff> below becomes a VirtualizedFileDiff
// automatically; `metrics` is its height estimate before real measurement.
//
// memo: App re-renders on every piece of global state (toasts, panel drags…)
// and maps over all files each time; with stable props this skips the
// per-file subtree entirely.
export const PierreDiffViewer = memo(function PierreDiffViewer({
  file,
  fileDiff,
  metrics,
  viewMode,
  collapsed,
  onToggleCollapsed,
  threads,
  commitContext,
  workspaceId,
  onAddComment,
  onUpdateComment,
  onRemoveComment,
  onCommentCopied,
}: PierreDiffViewerProps) {
  const { mode, darkShikiTheme, lightShikiTheme } = useTheme();

  // The open comment form, or null when none is open. Selection highlight is
  // derived from this (see `selectedLines`), so the pending form is the single
  // source of truth for "what is being commented on". No reset on file/commit
  // change is needed: App keys viewers by file path and the Virtualizer by
  // commit, so either change remounts this component.
  const [pending, setPending] = useState<PendingForm | null>(null);

  // Collapsing the file unmounts the diff body (and with it the annotation
  // slots), so an open form would survive invisibly and reappear on expand.
  useEffect(() => {
    if (collapsed) setPending(null);
  }, [collapsed]);

  // commit convention: an explicit hash targets that commit (side=new) and its
  // parent (side=old); no hash means the working tree diffed against HEAD.
  const commit = commitContext?.hash;

  // Only 'change'/'rename-changed'/'rename-pure' diffs can be hydrated from
  // full file contents (added/deleted files already carry their one full side
  // from the patch parse), and hydration needs a workspace to fetch from.
  // Binary files never render a FileDiff at all (see FileCard), so they need
  // no exclusion here.
  const canExpand =
    workspaceId != null && file.status !== "added" && file.status !== "deleted";

  const loadDiffFiles = useMemo(
    () =>
      canExpand && workspaceId != null
        ? buildDiffFilesLoader({ workspaceId, commit })
        : undefined,
    [canExpand, workspaceId, commit],
  );

  // openPendingForRange turns a library selection into a pending form.
  //
  // Two things are normalized here. First, the range is clamped to lines that
  // exist in `file.chunks`: the library happily selects expanded context rows
  // which carry no comment anchor, and the legacy renderer never offered
  // comments there. Second, the form is anchored on the range's last
  // commentable line, matching where the legacy form appeared.
  //
  // A selection with no commentable line leaves any existing form untouched.
  const openPendingForRange = useCallback(
    (range: SelectedLineRange): void => {
      // `endSide` is set only when a selection spans both columns in split
      // view; the library falls back to `side` otherwise, and omits both for
      // unambiguous unified selections.
      const side = toDiffSide(range.endSide ?? range.side);
      const clamped = clampRangeToPatch(file, side, range.start, range.end);
      if (!clamped) return;
      setPending({
        side,
        line: clamped.line,
        endLine: clamped.endLine,
        content: collectRangeSnapshot(file, side, clamped.line, clamped.endLine),
      });
    },
    [file],
  );

  // Selection callbacks live in `options`, which must stay referentially
  // stable. `useStableCallback` (the library's own helper) keeps a fixed
  // function identity while always invoking the latest closure, so these can
  // read current props/state without churning `options`.
  const handleLineSelected = useStableCallback((range: SelectedLineRange | null) => {
    // A null range is the library reporting that the selection was cleared
    // (e.g. clicking a selected single line again). Close the form to match:
    // the legacy renderer tied form visibility to the selection as well.
    if (range == null) {
      setPending(null);
      return;
    }
    openPendingForRange(range);
  });

  // The gutter "+" button opens a single-line form on the hovered line. This
  // is a separate path from selection because a plain hover-click should not
  // require the user to first select the line.
  const openPendingForLine = useStableCallback((side: DiffSide, lineNumber: number) => {
    if (!hasLineOnSide(file, side, lineNumber)) return;
    setPending({
      side,
      line: lineNumber,
      endLine: lineNumber,
      content: collectRangeSnapshot(file, side, lineNumber, lineNumber),
    });
  });

  const closePending = useCallback(() => setPending(null), []);

  const handleSubmit = useStableCallback((body: string) => {
    if (!pending) return;
    onAddComment({
      filePath: file.path,
      side: pending.side,
      line: pending.line,
      // endLine stays undefined for single-line threads, matching the storage
      // schema the legacy renderer wrote (and that CommentCard formats from).
      endLine: pending.endLine !== pending.line ? pending.endLine : undefined,
      body,
      codeSnapshot: pending.content,
    });
    setPending(null);
  });

  // Annotations and the selection range are both derived from `threads` +
  // `pending`, so they stay in sync by construction.
  const lineAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(
    () => buildAnnotations(threads, pending),
    [threads, pending],
  );

  const selectedLines = useMemo(() => buildSelectedLines(pending), [pending]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMeta>) => {
      const { threads: lineThreads, showForm } = annotation.metadata;
      return (
        <div className="flex flex-col gap-2 p-2">
          {lineThreads.map((thread) => (
            <CommentCard
              key={thread.id}
              thread={thread}
              commitContext={commitContext}
              onUpdateBody={(msgId, body) => onUpdateComment(thread.id, msgId, body)}
              onRemove={() => onRemoveComment(thread.id)}
              onCopied={onCommentCopied}
            />
          ))}
          {showForm && (
            <CommentForm onSubmit={handleSubmit} onCancel={closePending} />
          )}
        </div>
      );
    },
    [
      commitContext,
      onUpdateComment,
      onRemoveComment,
      onCommentCopied,
      handleSubmit,
      closePending,
    ],
  );

  // The gutter utility is a single node the library repositions onto whichever
  // line is hovered, so `getHoveredLine()` must be read at click time rather
  // than during render — at render time there is no hovered line yet.
  const renderGutterUtility = useCallback(
    (getHoveredLine: () => { lineNumber: number; side: "deletions" | "additions" } | undefined) => (
      <button
        type="button"
        title="クリックでコメント / ドラッグまたは Shift+クリックで複数行コメント"
        onClick={() => {
          const hovered = getHoveredLine();
          if (!hovered) return;
          openPendingForLine(toDiffSide(hovered.side), hovered.lineNumber);
        }}
        className="flex items-center justify-center w-5 h-5 rounded bg-blue-500 text-white hover:bg-blue-600 shadow"
      >
        <MessageSquarePlus size={12} />
      </button>
    ),
    [openPendingForLine],
  );

  // Options must be referentially stable: the React binding compares the
  // object against the live instance's options and forces a full re-render
  // whenever they differ, so a fresh object each render would re-highlight
  // the whole file on every parent update.
  // The options generic must match the annotation metadata type so `options`
  // and `lineAnnotations` describe the same FileDiff instantiation.
  const options = useMemo<FileDiffOptions<AnnotationMeta>>(
    () => ({
      diffStyle: viewMode === "split" ? "split" : "unified",
      // 'classic' draws the familiar +/- prefix column, matching what the
      // legacy renderer showed (the library default is 'bars').
      diffIndicators: "classic",
      // diffmil supplies its own header via <FileCard> around this component.
      disableFileHeader: true,
      themeType: mode,
      theme: { dark: darkShikiTheme, light: lightShikiTheme },
      // 'line-info' is the library default and shows the collapsed-context
      // line counts. Its expand buttons are gated on the diff being
      // hydratable — when `loadDiffFiles` is present (canExpand above), the
      // renderer shows working expand controls; otherwise it omits them
      // rather than rendering dead controls.
      hunkSeparators: "line-info",
      loadDiffFiles,
      expansionLineCount: 20,
      // Line selection provides range comments for free: click-drag and
      // Shift+click extension are built into the InteractionManager, so the
      // legacy renderer's manual anchor tracking is no longer needed.
      enableLineSelection: true,
      // Reserves the gutter slot that `renderGutterUtility` fills. Note the
      // library throws if `onGutterUtilityClick` is supplied alongside
      // `renderGutterUtility` — we use the render prop so the "+" button is a
      // real React node and can keep the legacy styling.
      enableGutterUtility: true,
      // `controlledSelection` tells the manager that `selectedLines` is the
      // authority, so it does not keep its own divergent copy while the
      // pending form drives the highlight.
      controlledSelection: true,
      // onLineSelected fires when a selection gesture completes (pointer-up or
      // Shift+click), which is exactly when the form should open. The
      // intermediate onLineSelectionChange events are ignored: reacting to
      // them would reopen/move the form on every pixel of a drag.
      onLineSelected: handleLineSelected,
    }),
    [
      viewMode,
      mode,
      darkShikiTheme,
      lightShikiTheme,
      loadDiffFiles,
      handleLineSelected,
    ],
  );

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
      <FileDiff
        fileDiff={fileDiff}
        metrics={metrics}
        options={options}
        lineAnnotations={lineAnnotations}
        selectedLines={selectedLines}
        renderAnnotation={renderAnnotation}
        renderGutterUtility={renderGutterUtility}
      />
    </FileCard>
  );
});
