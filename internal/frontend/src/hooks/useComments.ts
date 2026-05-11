import { useCallback, useEffect, useState } from "react";
import type { CommentThread, DiffSide } from "../types";
import { loadFromStorage, saveToStorage } from "../utils/storage";

const KEY_PREFIX = "diffmil.comments.";

function storageKey(commitHash: string): string {
  return KEY_PREFIX + commitHash;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadThreads(commitHash: string): CommentThread[] {
  return loadFromStorage<CommentThread[]>(
    storageKey(commitHash),
    (raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as CommentThread[];
      } catch {
        // ignore
      }
      return undefined;
    },
    [],
  );
}

function saveThreads(commitHash: string, threads: CommentThread[]): void {
  saveToStorage(storageKey(commitHash), JSON.stringify(threads));
}

export interface UseCommentsResult {
  threads: CommentThread[];
  addThread: (params: {
    filePath: string;
    side: DiffSide;
    line: number;
    body: string;
    codeSnapshot: string;
  }) => void;
  updateMessage: (threadId: string, messageId: string, body: string) => void;
  removeThread: (threadId: string) => void;
}

export function useComments(commitHash: string | null): UseCommentsResult {
  const [threads, setThreads] = useState<CommentThread[]>(() =>
    commitHash ? loadThreads(commitHash) : [],
  );

  useEffect(() => {
    setThreads(commitHash ? loadThreads(commitHash) : []);
  }, [commitHash]);

  const persist = useCallback(
    (next: CommentThread[]) => {
      if (commitHash) saveThreads(commitHash, next);
      return next;
    },
    [commitHash],
  );

  const addThread = useCallback<UseCommentsResult["addThread"]>(
    ({ filePath, side, line, body, codeSnapshot }) => {
      if (!commitHash) return;
      const now = new Date().toISOString();
      const thread: CommentThread = {
        id: createId(),
        commitHash,
        filePath,
        side,
        line,
        codeSnapshot,
        createdAt: now,
        updatedAt: now,
        messages: [{ id: createId(), body, createdAt: now, updatedAt: now }],
      };
      setThreads((prev) => persist([...prev, thread]));
    },
    [commitHash, persist],
  );

  const updateMessage = useCallback<UseCommentsResult["updateMessage"]>(
    (threadId, messageId, body) => {
      setThreads((prev) => {
        const next = prev.map((t) => {
          if (t.id !== threadId) return t;
          const now = new Date().toISOString();
          return {
            ...t,
            updatedAt: now,
            messages: t.messages.map((m) =>
              m.id === messageId ? { ...m, body, updatedAt: now } : m,
            ),
          };
        });
        return persist(next);
      });
    },
    [persist],
  );

  const removeThread = useCallback<UseCommentsResult["removeThread"]>(
    (threadId) => {
      setThreads((prev) => persist(prev.filter((t) => t.id !== threadId)));
    },
    [persist],
  );

  return { threads, addThread, updateMessage, removeThread };
}
