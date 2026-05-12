import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ThemedToken } from "shiki";
import type {
  CommentThread,
  DiffFile,
  DiffLine,
  DiffSide,
  DiffViewMode,
} from "../types";
import { DiffChunk } from "./DiffChunk";
import { SplitDiffChunk } from "./SplitDiffChunk";
import { CommentCard } from "./CommentCard";
import { CommentForm } from "./CommentForm";
import { useHighlighter, detectLanguage } from "../hooks/useHighlighter";
import { STATUS_META } from "../constants/status";
import { isAutoFoldPath } from "../constants/autoFold";
import type { CommitContext } from "../utils/commentPrompt";
import { collectRangeSnapshot, pickSideAndLine } from "../utils/diffLine";

interface DiffViewerProps {
  file: DiffFile;
  shikiTheme: string;
  viewMode: DiffViewMode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  threads: CommentThread[];
  commitContext?: CommitContext;
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

interface PendingForm {
  side: DiffSide;
  // line/endLine are the inclusive range. For single-line comments they are equal.
  line: number;
  endLine: number;
  // anchorLine is the originating line of this selection — set by the initial
  // plain click and never moved by subsequent Shift+clicks. Range endpoints
  // are recomputed as min/max(anchorLine, latest shift-click line).
  anchorLine: number;
  // formAt is the line under which the comment input is rendered. Matches the
  // most recent Shift+clicked line (GitHub shows the form under the
  // terminal line of the range).
  formAt: number;
  content: string;
}

function lineKey(side: DiffSide, line: number): string {
  return `${side}:${line}`;
}

export function DiffViewer({
  file,
  shikiTheme,
  viewMode,
  collapsed,
  onToggleCollapsed,
  threads,
  commitContext,
  onAddComment,
  onUpdateComment,
  onRemoveComment,
  onCommentCopied,
}: DiffViewerProps) {
  const meta = STATUS_META[file.status] ?? STATUS_META.modified;
  const autoFold = isAutoFoldPath(file.path);
  const { ready, highlightLines } = useHighlighter();
  const [pending, setPending] = useState<PendingForm | null>(null);
  // shiftHeld drives row-level UI changes while the user holds Shift: the
  // per-line "add comment" button is hidden so it doesn't block clicks on the
  // line itself, mirroring how GitHub PR review behaves during range selection.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    // window blur can leave Shift "stuck" if the user releases off-window.
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const threadsByLine = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    for (const t of threads) {
      const key = lineKey(t.side, t.line);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [threads]);

  const allLineTokens = useMemo(() => {
    if (collapsed) return null;
    if (!ready || file.chunks.length === 0) return null;

    const lang = detectLanguage(file.path);
    const allLines: string[] = [];

    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        allLines.push(line.content);
      }
    }

    const tokens = highlightLines(allLines, lang, shikiTheme);
    if (tokens.length === 0) return null;

    const result: (ThemedToken[] | undefined)[][] = [];
    let idx = 0;
    for (const chunk of file.chunks) {
      const chunkTokens: (ThemedToken[] | undefined)[] = [];
      for (let i = 0; i < chunk.lines.length; i++) {
        chunkTokens.push(tokens[idx]);
        idx++;
      }
      result.push(chunkTokens);
    }
    return result;
  }, [ready, file, shikiTheme, highlightLines, collapsed]);

  const handleAddComment = (
    side: DiffSide,
    line: number,
    content: string,
    extend: boolean,
  ) => {
    // Shift+click with an open pending form on the same side.
    if (extend && pending && pending.side === side && pending.anchorLine !== line) {
      // Clicking above the anchor cancels the existing selection and starts a
      // fresh single-line pending at the clicked line.
      if (line < pending.anchorLine) {
        setPending({ side, line, endLine: line, anchorLine: line, formAt: line, content });
        return;
      }
      // Otherwise extend the range downward from the unchanged anchor.
      const snapshot = collectRangeSnapshot(file, side, pending.anchorLine, line);
      setPending({
        side,
        line: pending.anchorLine,
        endLine: line,
        anchorLine: pending.anchorLine,
        formAt: line,
        content: snapshot,
      });
      return;
    }
    // Plain click (or Shift+click without a prior pending form): single-line form.
    setPending({ side, line, endLine: line, anchorLine: line, formAt: line, content });
  };

  const rangeStateFor = (
    targetSide: DiffSide,
    targetLine: number,
  ): "anchor" | "in-range" | null => {
    if (!pending || pending.side !== targetSide) return null;
    if (targetLine < pending.line || targetLine > pending.endLine) return null;
    return targetLine === pending.anchorLine ? "anchor" : "in-range";
  };

  const rangeStateForLineUnified = (line: DiffLine): "anchor" | "in-range" | null => {
    const t = pickSideAndLine(line);
    if (!t) return null;
    return rangeStateFor(t.side, t.lineNumber);
  };

  const rangeStateForSplit = (
    side: DiffSide,
    line: DiffLine,
  ): "anchor" | "in-range" | null => {
    const ln = side === "old" ? line.oldLineNumber : line.newLineNumber;
    if (ln == null) return null;
    return rangeStateFor(side, ln);
  };

  const renderExtra = (
    targetSide: DiffSide,
    targetLine: number,
  ): ReactNode => {
    const key = lineKey(targetSide, targetLine);
    const lineThreads = threadsByLine.get(key) ?? [];
    const showForm = pending?.side === targetSide && pending.formAt === targetLine;
    if (lineThreads.length === 0 && !showForm) return null;
    return (
      <div className="flex flex-col gap-2">
        {lineThreads.map((t) => (
          <CommentCard
            key={t.id}
            thread={t}
            commitContext={commitContext}
            onUpdateBody={(msgId, body) => onUpdateComment(t.id, msgId, body)}
            onRemove={() => onRemoveComment(t.id)}
            onCopied={onCommentCopied}
          />
        ))}
        {showForm && pending && (
          <CommentForm
            onSubmit={(body) => {
              onAddComment({
                filePath: file.path,
                side: pending.side,
                line: pending.line,
                endLine: pending.endLine !== pending.line ? pending.endLine : undefined,
                body,
                codeSnapshot: pending.content,
              });
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    );
  };

  const renderUnifiedExtra = (line: DiffLine): ReactNode => {
    const target = pickSideAndLine(line);
    if (!target) return null;
    return renderExtra(target.side, target.lineNumber);
  };

  const renderSplitExtra = (line: DiffLine, side: DiffSide): ReactNode => {
    const lineNumber = side === "old" ? line.oldLineNumber : line.newLineNumber;
    if (lineNumber == null) return null;
    return renderExtra(side, lineNumber);
  };

  return (
    <div
      id={`file-${encodeURIComponent(file.path)}`}
      className="border border-gh-border rounded-md mb-4 overflow-hidden"
    >
      {/* File header */}
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
        {threads.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
            💬 {threads.length}
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

      {/* Diff content */}
      {collapsed ? null : file.isBinary ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          Binary file not shown
        </div>
      ) : file.chunks.length === 0 ? (
        <div className="px-4 py-3 text-gh-text-muted text-sm italic">
          No changes
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className={`border-collapse ${viewMode === "split" ? "w-full table-fixed" : "w-full"}`}
          >
            {viewMode === "split" && (
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "50%" }} />
                <col style={{ width: "40px" }} />
                <col style={{ width: "50%" }} />
              </colgroup>
            )}
            <tbody>
              {file.chunks.map((chunk, i) =>
                viewMode === "split" ? (
                  <SplitDiffChunk
                    key={i}
                    chunk={chunk}
                    lineTokens={allLineTokens?.[i]}
                    onAddComment={handleAddComment}
                    renderLineExtra={renderSplitExtra}
                    rangeStateFor={rangeStateForSplit}
                    hideAddButton={shiftHeld}
                  />
                ) : (
                  <DiffChunk
                    key={i}
                    chunk={chunk}
                    lineTokens={allLineTokens?.[i]}
                    onAddComment={handleAddComment}
                    renderLineExtra={renderUnifiedExtra}
                    rangeStateForLine={rangeStateForLineUnified}
                    hideAddButton={shiftHeld}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
