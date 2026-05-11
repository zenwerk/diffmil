import { useState } from "react";
import { Edit2, Trash2, Copy } from "lucide-react";
import type { CommentThread } from "../types";
import { CommentForm } from "./CommentForm";
import {
  copyToClipboard,
  formatThreadPrompt,
  type CommitContext,
} from "../utils/commentPrompt";

interface CommentCardProps {
  thread: CommentThread;
  commitContext?: CommitContext;
  onUpdateBody: (messageId: string, body: string) => void;
  onRemove: () => void;
  onCopied?: () => void;
}

export function CommentCard({
  thread,
  commitContext,
  onUpdateBody,
  onRemove,
  onCopied,
}: CommentCardProps) {
  const message = thread.messages[0];
  type CardMode = "view" | "edit" | "confirmDelete";
  const [mode, setMode] = useState<CardMode>("view");

  const handleCopy = async () => {
    const ok = await copyToClipboard(formatThreadPrompt(thread, commitContext));
    if (ok) onCopied?.();
  };

  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded p-3 text-sm">
      <div className="flex items-center gap-2 mb-2 text-xs text-gh-text-muted">
        <span className="font-mono">
          {thread.filePath}:L{thread.line}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-gh-bg-tertiary text-[10px]">
          {thread.side}
        </span>
        <span className="ml-auto">
          {new Date(thread.createdAt).toLocaleString()}
        </span>
      </div>
      {mode === "edit" ? (
        <CommentForm
          initialBody={message.body}
          submitLabel="保存"
          onSubmit={(body) => {
            onUpdateBody(message.id, body);
            setMode("view");
          }}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          <div className="text-gh-text-primary whitespace-pre-wrap break-words">
            {message.body}
          </div>
          <div className="flex items-center gap-1 mt-2">
            <button
              onClick={handleCopy}
              title="プロンプト形式でコピー"
              className="p-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={() => setMode("edit")}
              title="編集"
              className="p-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
            >
              <Edit2 size={14} />
            </button>
            {mode === "confirmDelete" ? (
              <span className="ml-2 flex items-center gap-2 text-xs">
                <span className="text-gh-warning">削除しますか？</span>
                <button
                  onClick={onRemove}
                  className="px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  削除
                </button>
                <button
                  onClick={() => setMode("view")}
                  className="px-2 py-0.5 rounded text-gh-text-secondary hover:bg-gh-bg-tertiary transition-colors"
                >
                  キャンセル
                </button>
              </span>
            ) : (
              <button
                onClick={() => setMode("confirmDelete")}
                title="削除"
                className="p-1 rounded text-gh-text-muted hover:text-red-400 hover:bg-gh-bg-tertiary transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
