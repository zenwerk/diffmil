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
  forEachWorkspaceKey(wsId, (key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.some(isValidThread)) {
        const prefix = wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
        out.add(key.slice(prefix.length));
      }
    } catch {
      // ignore
    }
  });
  return out;
}

// forEachWorkspaceKey iterates over localStorage keys that belong to the given
// workspace's comment namespace. With wsId === null, the legacy flat namespace
// is scanned. Snapshots the key list up-front so callbacks can safely mutate
// localStorage while iterating.
function forEachWorkspaceKey(wsId: string | null, cb: (key: string) => void): void {
  const prefix = wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
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

// loadAllWorkspaceThreads returns every valid thread across all commits in the
// given workspace, keyed by commit hash. Used for cross-commit bulk operations
// such as "copy all" / "delete all" within a workspace.
export function loadAllWorkspaceThreads(
  wsId: string | null,
): Map<string, CommentThread[]> {
  const out = new Map<string, CommentThread[]>();
  const prefix = wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
  forEachWorkspaceKey(wsId, (key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(isValidThread);
      if (valid.length === 0) return;
      out.set(key.slice(prefix.length), valid);
    } catch {
      // ignore
    }
  });
  return out;
}

// pruneOrphanWorkspaceComments removes comment entries for commit hashes that
// no longer exist in `keepHashes`. Returns the number of *threads* dropped so
// the caller can surface a toast / log. Used when the upstream commit history
// changes (reset --hard, branch switch, force-push) and previously-commented
// commits are no longer reachable.
export function pruneOrphanWorkspaceComments(
  wsId: string | null,
  keepHashes: Set<string>,
): number {
  let removed = 0;
  const prefix = wsId ? `${KEY_PREFIX}${wsId}.` : KEY_PREFIX;
  forEachWorkspaceKey(wsId, (key) => {
    const hash = key.slice(prefix.length);
    if (keepHashes.has(hash)) return;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) removed += parsed.filter(isValidThread).length;
      } catch {
        // ignore
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  });
  return removed;
}

// clearAllWorkspaceComments removes every comment-bearing localStorage entry
// for the given workspace. Returns the number of removed *threads* (not keys)
// so the caller can show a meaningful toast.
export function clearAllWorkspaceComments(wsId: string | null): number {
  let removed = 0;
  forEachWorkspaceKey(wsId, (key) => {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) removed += parsed.filter(isValidThread).length;
      } catch {
        // ignore
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
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
