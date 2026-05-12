import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentThread, DiffSide } from "../types";
import { loadFromStorage, saveToStorage } from "../utils/storage";
import { createId } from "../utils/id";

const KEY_PREFIX = "diffmil.comments.";

// storageKey returns a localStorage key namespaced by workspace.
// Workspace-less mode keeps the legacy "diffmil.comments.<hash>" key for back-compat.
function storageKey(commitHash: string, wsId: string | null): string {
  if (wsId) return `${KEY_PREFIX}${wsId}.${commitHash}`;
  return KEY_PREFIX + commitHash;
}

// listCommitsWithComments scans localStorage for comment-bearing commit hashes
// belonging to the given workspace ID. With wsId === null, the legacy flat
// "diffmil.comments.<hash>" namespace is scanned for back-compat with data
// saved before workspaces existed.
export function listCommitsWithComments(wsId: string | null): Set<string> {
  const out = new Set<string>();
  const prefix = wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      // For legacy scan, skip entries that contain a workspace-id segment
      // (they look like "diffmil.comments.<wsId>.<hash>" and contain extra dots).
      if (!wsId) {
        const suffix = key.slice(prefix.length);
        if (suffix.includes(".")) continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.some(isValidThread)) {
          out.add(key.slice(prefix.length));
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return out;
}

function isValidThread(t: unknown): t is CommentThread {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  if (obj.endLine !== undefined && typeof obj.endLine !== "number") return false;
  return (
    typeof obj.id === "string" &&
    typeof obj.filePath === "string" &&
    typeof obj.line === "number" &&
    (obj.side === "old" || obj.side === "new") &&
    Array.isArray(obj.messages) &&
    obj.messages.length > 0
  );
}

function loadThreads(wsId: string | null, commitHash: string): CommentThread[] {
  return loadFromStorage<CommentThread[]>(
    storageKey(commitHash, wsId),
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

function saveThreads(wsId: string | null, commitHash: string, threads: CommentThread[]): void {
  saveToStorage(storageKey(commitHash, wsId), JSON.stringify(threads));
}

export interface UseCommentsResult {
  threads: CommentThread[];
  addThread: (params: {
    filePath: string;
    side: DiffSide;
    line: number;
    endLine?: number;
    body: string;
    codeSnapshot: string;
  }) => void;
  updateMessage: (threadId: string, messageId: string, body: string) => void;
  removeThread: (threadId: string) => void;
}

export function useComments(
  wsId: string | null,
  commitHash: string | null,
): UseCommentsResult {
  const [threads, setThreads] = useState<CommentThread[]>([]);

  // Keep refs in sync so callbacks always see the current workspace/commit
  // when scheduling a setState updater function (avoids race conditions
  // during workspace or commit switch).
  const commitHashRef = useRef(commitHash);
  const wsIdRef = useRef(wsId);
  useEffect(() => {
    commitHashRef.current = commitHash;
  }, [commitHash]);
  useEffect(() => {
    wsIdRef.current = wsId;
  }, [wsId]);

  useEffect(() => {
    setThreads(commitHash ? loadThreads(wsId, commitHash) : []);
  }, [wsId, commitHash]);

  const persist = useCallback((next: CommentThread[]): CommentThread[] => {
    const hash = commitHashRef.current;
    if (hash) saveThreads(wsIdRef.current, hash, next);
    return next;
  }, []);

  const addThread = useCallback<UseCommentsResult["addThread"]>(
    ({ filePath, side, line, endLine, body, codeSnapshot }) => {
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
      if (endLine != null && endLine !== line) thread.endLine = endLine;
      setThreads((prev) => persist([...prev, thread]));
    },
    [persist],
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
