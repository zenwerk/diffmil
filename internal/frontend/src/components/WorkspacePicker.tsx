import { useState } from "react";
import { FolderGit2, Check, Edit2, Trash2 } from "lucide-react";
import type { Workspace } from "../types";
import { useDropdown } from "../hooks/useDropdown";
import { findById } from "../utils/list";
import type { EditableItemMode } from "../utils/editMode";

interface WorkspacePickerProps {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

interface EntryProps {
  workspace: Workspace;
  isActive: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
}

function Entry({
  workspace,
  isActive,
  canRemove,
  onSelect,
  onRemove,
  onRename,
}: EntryProps) {
  const [mode, setMode] = useState<EditableItemMode>("view");
  const [draftLabel, setDraftLabel] = useState(workspace.label);

  if (mode === "edit") {
    const trimmed = draftLabel.trim();
    const submit = () => {
      if (!trimmed) return;
      onRename(trimmed);
      setMode("view");
    };
    return (
      <div className="px-3 py-2 bg-gh-bg-tertiary flex items-center gap-2">
        <input
          autoFocus
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraftLabel(workspace.label);
              setMode("view");
            }
          }}
          className="flex-1 px-2 py-1 text-sm bg-gh-bg-primary border border-gh-border rounded text-gh-text-primary focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={submit}
          disabled={!trimmed}
          className="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={() => {
            setDraftLabel(workspace.label);
            setMode("view");
          }}
          className="px-2 py-1 text-xs rounded text-gh-text-secondary hover:bg-gh-bg-primary"
        >
          キャンセル
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group/entry px-3 py-2 transition-colors flex items-start gap-2 ${
        isActive
          ? "bg-gh-bg-tertiary text-gh-text-primary"
          : "text-gh-text-secondary hover:bg-gh-bg-tertiary hover:text-gh-text-primary"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex items-start gap-2 flex-1 min-w-0 text-left"
      >
        <div className="w-4 shrink-0 mt-0.5">
          {isActive && <Check size={14} className="text-blue-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{workspace.label}</div>
          <div className="text-xs text-gh-text-muted font-mono truncate" title={workspace.dir}>
            {workspace.dir}
          </div>
        </div>
      </button>
      {mode === "confirmDelete" ? (
        <span className="flex items-center gap-1 text-xs shrink-0">
          <button
            onClick={() => {
              onRemove();
              setMode("view");
            }}
            className="px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600"
          >
            削除
          </button>
          <button
            onClick={() => setMode("view")}
            className="px-2 py-0.5 rounded text-gh-text-secondary hover:bg-gh-bg-primary"
          >
            ×
          </button>
        </span>
      ) : (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/entry:opacity-100 transition-opacity">
          <button
            onClick={() => {
              setDraftLabel(workspace.label);
              setMode("edit");
            }}
            title="ラベル編集"
            className="p-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-primary"
          >
            <Edit2 size={12} />
          </button>
          {canRemove && (
            <button
              onClick={() => setMode("confirmDelete")}
              title="ワークスペースを削除"
              className="p-1 rounded text-gh-text-muted hover:text-red-400 hover:bg-gh-bg-primary"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkspacePicker({
  workspaces,
  activeId,
  onSelect,
  onRemove,
  onRename,
}: WorkspacePickerProps) {
  const { open, setOpen, containerRef } = useDropdown();
  const active = activeId ? findById(workspaces, activeId) ?? null : null;

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
        <div className="absolute left-0 top-full mt-1 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl min-w-[300px] max-w-md max-h-96 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-gh-text-muted border-b border-gh-border">
            ワークスペース ({workspaces.length})
          </div>
          {workspaces.map((ws) => (
            <Entry
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeId}
              canRemove={workspaces.length > 1}
              onSelect={() => {
                onSelect(ws.id);
                setOpen(false);
              }}
              onRemove={() => onRemove(ws.id)}
              onRename={(label) => onRename(ws.id, label)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
