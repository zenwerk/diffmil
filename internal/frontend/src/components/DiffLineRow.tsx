import type { MouseEvent } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { DiffLine, DiffSide } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX, LINE_BG_HOVER } from "../constants/diff";
import { pickSideAndLine } from "../utils/diffLine";

interface DiffLineRowProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  onAddComment?: (
    side: DiffSide,
    lineNumber: number,
    content: string,
    extend: boolean,
  ) => void;
  rangeState?: "anchor" | "in-range" | "committed" | null;
  hideAddButton?: boolean;
}

const LINE_BORDER: Record<string, string> = {
  add: "border-l-2 border-diff-addition-border",
  delete: "border-l-2 border-diff-deletion-border",
};

export function DiffLineRow({
  line,
  tokens,
  onAddComment,
  rangeState,
  hideAddButton,
}: DiffLineRowProps) {
  const target = pickSideAndLine(line);
  const canComment = onAddComment != null && target != null;
  const showButton = canComment && !hideAddButton;
  // When Shift is held the per-line button is hidden, but the line-number
  // cell itself becomes a Shift+click target so the user can still extend
  // the range by clicking another line.
  const handleGutterClick = (e: MouseEvent) => {
    if (!canComment || !e.shiftKey) return;
    onAddComment!(target!.side, target!.lineNumber, line.content, true);
  };
  const rangeBg =
    rangeState === "anchor"
      ? "bg-blue-500/20"
      : rangeState === "in-range"
        ? "bg-blue-500/10"
        : rangeState === "committed"
          ? "bg-blue-500/10"
          : "";

  return (
    <tr className={`group ${rangeBg || (LINE_BG_HOVER[line.type] ?? "hover:bg-line-hover")}`}>
      <td
        onClick={handleGutterClick}
        className={`w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative ${hideAddButton && canComment ? "cursor-pointer hover:bg-blue-500/15" : ""}`}
      >
        {line.oldLineNumber ?? ""}
      </td>
      <td
        onClick={handleGutterClick}
        className={`w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative ${hideAddButton && canComment ? "cursor-pointer hover:bg-blue-500/15" : ""}`}
      >
        {line.newLineNumber ?? ""}
        {showButton && (
          <button
            type="button"
            onClick={(e) =>
              onAddComment!(target!.side, target!.lineNumber, line.content, e.shiftKey)
            }
            title="クリックでコメント / Shift+クリックで複数行コメント"
            className="absolute -right-2 top-0 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded bg-blue-500 text-white hover:bg-blue-600 shadow"
          >
            <MessageSquarePlus size={12} />
          </button>
        )}
      </td>
      <td
        className={`px-2 font-mono text-[1em] whitespace-pre overflow-x-auto ${LINE_BORDER[line.type] ?? "border-l-2 border-transparent"}`}
      >
        <span className="text-gh-text-muted select-none">
          {LINE_PREFIX[line.type] ?? " "}
        </span>
        <TokenizedCode tokens={tokens} fallback={line.content} />
      </td>
    </tr>
  );
}
