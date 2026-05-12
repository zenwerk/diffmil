import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "../types";
import { loadFromStorage, saveToStorage } from "../utils/storage";
import { findById } from "../utils/list";

const ACTIVE_WS_KEY = "diffmil.activeWorkspace";

function loadActive(): string | null {
  return loadFromStorage<string | null>(
    ACTIVE_WS_KEY,
    (s) => (s ? s : undefined),
    null,
  );
}

function getUrlWs(): string | null {
  return new URLSearchParams(window.location.search).get("ws");
}

function setUrlWs(id: string | null) {
  const current = getUrlWs();
  if (current === id) return;
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("ws", id);
  } else {
    url.searchParams.delete("ws");
  }
  window.history.replaceState(null, "", url.toString());
}

async function fetchWorkspaces(): Promise<Workspace[]> {
  try {
    const res = await fetch("/_/api/workspaces");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as Workspace[]) : [];
  } catch {
    return [];
  }
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => getUrlWs() || loadActive(),
  );

  const refresh = useCallback(async () => {
    const list = await fetchWorkspaces();
    setWorkspaces(list);
    return list;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fall back to the first workspace when the persisted ID is no longer valid.
  useEffect(() => {
    if (workspaces.length === 0) return;
    if (!activeId || !findById(workspaces, activeId)) {
      setActiveIdState(workspaces[0].id);
    }
  }, [workspaces, activeId]);

  // Keep URL and localStorage in sync with the active workspace.
  useEffect(() => {
    if (!activeId) return;
    saveToStorage(ACTIVE_WS_KEY, activeId);
    setUrlWs(activeId);
  }, [activeId]);

  // Respond to back/forward navigation that changes ?ws=...
  useEffect(() => {
    const onPop = () => {
      const fromUrl = getUrlWs();
      if (fromUrl) setActiveIdState(fromUrl);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
  }, []);

  const addWorkspace = useCallback(
    async (dir: string): Promise<Workspace | null> => {
      const res = await fetch("/_/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      if (!res.ok) return null;
      const ws = (await res.json()) as Workspace;
      await refresh();
      return ws;
    },
    [refresh],
  );

  const removeWorkspace = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/_/api/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) return false;
      await refresh();
      return true;
    },
    [refresh],
  );

  const renameWorkspace = useCallback(
    async (id: string, label: string): Promise<boolean> => {
      const res = await fetch(`/_/api/workspaces/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return false;
      await refresh();
      return true;
    },
    [refresh],
  );

  const active = activeId ? findById(workspaces, activeId) ?? null : null;

  return {
    workspaces,
    active,
    activeId: active?.id ?? null,
    setActiveId,
    addWorkspace,
    removeWorkspace,
    renameWorkspace,
    refresh,
  };
}
