import type { Commit, CommentThread } from "../types";

export interface CommitContext {
  hash: string;
  short?: string;
  subject?: string;
  author?: string;
  date?: string;
}

function formatCommitHeader(ctx: CommitContext): string {
  const lines: string[] = [];
  const head = ctx.short ? `${ctx.short} (${ctx.hash})` : ctx.hash;
  lines.push(`Commit: ${head}`);
  if (ctx.subject) lines.push(`Subject: ${ctx.subject}`);
  if (ctx.author) lines.push(`Author: ${ctx.author}`);
  if (ctx.date) lines.push(`Date: ${ctx.date}`);
  return lines.join("\n");
}

export function toCommitContext(commit: Commit | null, fallbackHash: string): CommitContext {
  if (commit) {
    return {
      hash: commit.hash,
      short: commit.short,
      subject: commit.subject,
      author: commit.author,
      date: commit.date,
    };
  }
  return { hash: fallbackHash };
}

export function formatThreadPrompt(thread: CommentThread, commit?: CommitContext): string {
  const lines: string[] = [];
  const ctx = commit ?? { hash: thread.commitHash };
  lines.push(formatCommitHeader(ctx));
  lines.push(`File: ${thread.filePath}:L${thread.line} (${thread.side})`);
  lines.push("```");
  lines.push(thread.codeSnapshot);
  lines.push("```");
  for (const msg of thread.messages) {
    lines.push(msg.body);
  }
  return lines.join("\n");
}

export function formatAllThreadsPrompt(threads: CommentThread[], commit?: CommitContext): string {
  return threads.map((t) => formatThreadPrompt(t, commit)).join("\n=====\n");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
