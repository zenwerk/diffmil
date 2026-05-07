import type { ThemedToken } from "shiki";
import type { DiffLine } from "../types";
import { TokenizedCode } from "./TokenizedCode";
import { LINE_PREFIX } from "../constants/diff";

interface DiffLineRowProps {
  line: DiffLine;
  tokens?: ThemedToken[];
}

const LINE_BG: Record<string, string> = {
  add: "bg-diff-addition-bg hover:bg-diff-add-hover",
  delete: "bg-diff-deletion-bg hover:bg-diff-del-hover",
};

const LINE_BORDER: Record<string, string> = {
  add: "border-l-2 border-diff-addition-border",
  delete: "border-l-2 border-diff-deletion-border",
};

export function DiffLineRow({ line, tokens }: DiffLineRowProps) {
  return (
    <tr className={`${LINE_BG[line.type] ?? "hover:bg-line-hover"}`}>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-[0.85em] align-top whitespace-nowrap">
        {line.newLineNumber ?? ""}
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
