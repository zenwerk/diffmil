import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "../types";
import { loadFromStorage, saveToStorage } from "../utils/storage";

const ACTIVE_WS_KEY = "diffmil.activeWorkspace";

function loadActive(): string | null {
  return loadFromStorage<string | null>(
    ACTIVE_WS_KEY,
    (s) => (s ? s : undefined),
    null,
  );
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
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("ws");
    return fromUrl || loadActive();
  });

  const refresh = useCallback(async () => {
    const list = await fetchWorkspaces();
    setWorkspaces(list);
    return list;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Make sure activeId is valid (falls back to first workspace if missing).
  useEffect(() => {
    if (workspaces.length === 0) return;
    if (!activeId || !workspaces.some((w) => w.id === activeId)) {
      setActiveIdState(workspaces[0].id);
    }
  }, [workspaces, activeId]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    saveToStorage(ACTIVE_WS_KEY, id);
  }, []);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return { workspaces, active, activeId: active?.id ?? null, setActiveId, refresh };
}
