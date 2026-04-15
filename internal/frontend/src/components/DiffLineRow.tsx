import type { ThemedToken } from "shiki";
import type { DiffLine } from "../types";

interface DiffLineRowProps {
  line: DiffLine;
  tokens?: ThemedToken[];
}

export function DiffLineRow({ line, tokens }: DiffLineRowProps) {
  const bgClass =
    line.type === "add"
      ? "bg-diff-addition-bg"
      : line.type === "delete"
        ? "bg-diff-deletion-bg"
        : "";

  const borderClass =
    line.type === "add"
      ? "border-l-2 border-diff-addition-border"
      : line.type === "delete"
        ? "border-l-2 border-diff-deletion-border"
        : "border-l-2 border-transparent";

  const prefix =
    line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

  return (
    <tr className={`${bgClass} hover:brightness-125`}>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-[1%] min-w-[50px] px-2 text-right text-gh-text-muted select-none font-mono text-xs align-top whitespace-nowrap">
        {line.newLineNumber ?? ""}
      </td>
      <td
        className={`px-2 font-mono text-sm whitespace-pre overflow-x-auto ${borderClass}`}
      >
        <span className="text-gh-text-muted select-none">{prefix}</span>
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span key={i} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          line.content
        )}
      </td>
    </tr>
  );
}
