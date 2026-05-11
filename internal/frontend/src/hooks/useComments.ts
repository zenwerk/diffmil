import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentThread, DiffSide } from "../types";
import { loadFromStorage, saveToStorage } from "../utils/storage";
import { createId } from "../utils/id";

const KEY_PREFIX = "diffmil.comments.";

function storageKey(commitHash: string): string {
  return KEY_PREFIX + commitHash;
}

function isValidThread(t: unknown): t is CommentThread {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.filePath === "string" &&
    typeof obj.line === "number" &&
    (obj.side === "old" || obj.side === "new") &&
    Array.isArray(obj.messages) &&
    obj.messages.length > 0
  );
}

function loadThreads(commitHash: string): CommentThread[] {
  return loadFromStorage<CommentThread[]>(
    storageKey(commitHash),
    (raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(isValidThread);
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
  const [threads, setThreads] = useState<CommentThread[]>([]);

  // Keep ref in sync so callbacks always see the current commit when scheduling
  // a setState updater function (avoids race condition during commit switch).
  const commitHashRef = useRef(commitHash);
  useEffect(() => {
    commitHashRef.current = commitHash;
  }, [commitHash]);

  useEffect(() => {
    setThreads(commitHash ? loadThreads(commitHash) : []);
  }, [commitHash]);

  const persist = (next: CommentThread[]): CommentThread[] => {
    const hash = commitHashRef.current;
    if (hash) saveThreads(hash, next);
    return next;
  };

  const addThread = useCallback<UseCommentsResult["addThread"]>(
    ({ filePath, side, line, body, codeSnapshot }) => {
      const hash = commitHashRef.current;
      if (!hash) return;
      const now = new Date().toISOString();
      const thread: CommentThread = {
        id: createId(),
        commitHash: hash,
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
    [],
  );

  const updateMessage = useCallback<UseCommentsResult["updateMessage"]>(
    (threadId, messageId, body) => {
      setThreads((prev) => {
        const now = new Date().toISOString();
        const next = prev.map((t) => {
          if (t.id !== threadId) return t;
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
    [],
  );

  const removeThread = useCallback<UseCommentsResult["removeThread"]>(
    (threadId) => {
      setThreads((prev) => persist(prev.filter((t) => t.id !== threadId)));
    },
    [],
  );

  return { threads, addThread, updateMessage, removeThread };
}
