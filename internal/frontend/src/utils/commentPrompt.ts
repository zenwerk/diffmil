import type { CommentThread } from "../types";

export function formatThreadPrompt(thread: CommentThread): string {
  const lines: string[] = [];
  lines.push(`${thread.filePath}:L${thread.line} (${thread.side})`);
  lines.push("```");
  lines.push(thread.codeSnapshot);
  lines.push("```");
  for (const msg of thread.messages) {
    lines.push(msg.body);
  }
  return lines.join("\n");
}

export function formatAllThreadsPrompt(threads: CommentThread[]): string {
  return threads.map(formatThreadPrompt).join("\n=====\n");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
