import { FolderGit2, Check } from "lucide-react";
import type { Workspace } from "../types";
import { useDropdown } from "../hooks/useDropdown";

interface WorkspacePickerProps {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function WorkspacePicker({ workspaces, activeId, onSelect }: WorkspacePickerProps) {
  const { open, setOpen, containerRef } = useDropdown();
  const active = workspaces.find((w) => w.id === activeId) ?? null;

  if (workspaces.length === 0) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={active?.dir ?? "Workspace"}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-gh-text-secondary hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
      >
        <FolderGit2 size={14} className="shrink-0" />
        <span className="font-medium truncate max-w-[160px]">
          {active?.label ?? "Select workspace"}
        </span>
        {workspaces.length > 1 && (
          <span className="text-xs text-gh-text-muted">({workspaces.length})</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl min-w-[260px] max-w-md max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-gh-text-muted border-b border-gh-border">
            ワークスペース ({workspaces.length})
          </div>
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId;
            return (
              <button
                key={ws.id}
                onClick={() => {
                  onSelect(ws.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2 ${
                  isActive
                    ? "bg-gh-bg-tertiary text-gh-text-primary"
                    : "text-gh-text-secondary hover:bg-gh-bg-tertiary hover:text-gh-text-primary"
                }`}
              >
                <div className="w-4 shrink-0 mt-0.5">
                  {isActive && <Check size={14} className="text-blue-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{ws.label}</div>
                  <div className="text-xs text-gh-text-muted font-mono truncate" title={ws.dir}>
                    {ws.dir}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
