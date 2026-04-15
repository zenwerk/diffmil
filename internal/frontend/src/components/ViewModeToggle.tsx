import { Columns2, AlignLeft } from "lucide-react";
import type { DiffViewMode } from "../types";

interface ViewModeToggleProps {
  mode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}

const modes: { value: DiffViewMode; icon: typeof AlignLeft; label: string }[] =
  [
    { value: "unified", icon: AlignLeft, label: "Unified" },
    { value: "split", icon: Columns2, label: "Split" },
  ];

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5 bg-gh-bg-tertiary rounded-md p-0.5">
      {modes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
            mode === value
              ? "bg-gh-bg-primary text-gh-text-primary shadow-sm"
              : "text-gh-text-muted hover:text-gh-text-secondary"
          }`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
