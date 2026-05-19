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

function workspacePrefix(wsId: string | null): string {
  return wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
}

// Snapshots the key list up-front so callbacks can safely mutate localStorage
// while iterating.
function forEachWorkspaceKey(wsId: string | null, cb: (key: string) => void): void {
  const prefix = workspacePrefix(wsId);
  const matched: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      if (!wsId) {
        // Legacy scan: exclude workspace-scoped keys (which contain an extra dot).
        const suffix = key.slice(prefix.length);
        if (suffix.includes(".")) continue;
      }
      matched.push(key);
    }
  } catch {
    return;
  }
  for (const key of matched) cb(key);
}

function parseThreads(raw: string | null): CommentThread[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(isValidThread);
  } catch {
    // ignore
  }
  return [];
}

// removeAndCount removes a localStorage entry and returns the number of valid
// threads it contained. Shared between clearAll and pruneOrphan.
function removeAndCount(key: string): number {
  const valid = parseThreads(localStorage.getItem(key));
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  return valid.length;
}

// listCommitsWithComments scans localStorage for comment-bearing commit hashes
// in the given workspace. With wsId === null, the legacy flat namespace is
// scanned for back-compat with data saved before workspaces existed.
export function listCommitsWithComments(wsId: string | null): Set<string> {
  const out = new Set<string>();
  const prefix = workspacePrefix(wsId);
  forEachWorkspaceKey(wsId, (key) => {
    if (parseThreads(localStorage.getItem(key)).length > 0) {
      out.add(key.slice(prefix.length));
    }
  });
  return out;
}

export function loadAllWorkspaceThreads(
  wsId: string | null,
): Map<string, CommentThread[]> {
  const out = new Map<string, CommentThread[]>();
  const prefix = workspacePrefix(wsId);
  forEachWorkspaceKey(wsId, (key) => {
    const valid = parseThreads(localStorage.getItem(key));
    if (valid.length > 0) out.set(key.slice(prefix.length), valid);
  });
  return out;
}

export function countWorkspaceThreads(wsId: string | null): number {
  let n = 0;
  for (const arr of loadAllWorkspaceThreads(wsId).values()) n += arr.length;
  return n;
}

// pruneOrphanWorkspaceComments removes entries whose commit hash is not in
// `keepHashes`. Returns the number of *threads* dropped. Used when upstream
// history changes (reset --hard, branch switch, force-push) leave orphans.
export function pruneOrphanWorkspaceComments(
  wsId: string | null,
  keepHashes: Set<string>,
): number {
  let removed = 0;
  const prefix = workspacePrefix(wsId);
  forEachWorkspaceKey(wsId, (key) => {
    const hash = key.slice(prefix.length);
    if (keepHashes.has(hash)) return;
    removed += removeAndCount(key);
  });
  return removed;
}

export function clearAllWorkspaceComments(wsId: string | null): number {
  let removed = 0;
  forEachWorkspaceKey(wsId, (key) => {
    removed += removeAndCount(key);
  });
  return removed;
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
      const parsed = parseThreads(raw);
      return parsed.length > 0 ? parsed : undefined;
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
  clearAll: () => void;
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

  const clearAll = useCallback<UseCommentsResult["clearAll"]>(() => {
    setThreads(() => persist([]));
  }, [persist]);

  return { threads, addThread, updateMessage, removeThread, clearAll };
}
