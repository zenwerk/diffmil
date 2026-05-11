import { MessageSquarePlus } from "lucide-react";
import type { ThemedToken } from "shiki";
import type { DiffLine, DiffSide } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX, LINE_BG_HOVER } from "../constants/diff";

interface DiffLineRowProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  onAddComment?: (side: DiffSide, lineNumber: number, content: string) => void;
}

const LINE_BORDER: Record<string, string> = {
  add: "border-l-2 border-diff-addition-border",
  delete: "border-l-2 border-diff-deletion-border",
};

function pickSideAndLine(line: DiffLine): { side: DiffSide; lineNumber: number } | null {
  if (line.type === "delete" && line.oldLineNumber != null) {
    return { side: "old", lineNumber: line.oldLineNumber };
  }
  if (line.type === "add" && line.newLineNumber != null) {
    return { side: "new", lineNumber: line.newLineNumber };
  }
  if (line.type === "normal" && line.newLineNumber != null) {
    return { side: "new", lineNumber: line.newLineNumber };
  }
  if (line.oldLineNumber != null) {
    return { side: "old", lineNumber: line.oldLineNumber };
  }
  return null;
}

export function DiffLineRow({ line, tokens, onAddComment }: DiffLineRowProps) {
  const target = pickSideAndLine(line);
  const canComment = onAddComment != null && target != null;

  return (
    <tr className={`group ${LINE_BG_HOVER[line.type] ?? "hover:bg-line-hover"}`}>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap relative">
        {line.newLineNumber ?? ""}
        {canComment && (
          <button
            type="button"
            onClick={() => onAddComment(target.side, target.lineNumber, line.content)}
            title="コメントを追加"
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
