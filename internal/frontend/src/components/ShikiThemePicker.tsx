import { Palette } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useDropdown } from "../hooks/useDropdown";
import { SHIKI_THEMES } from "../constants/shikiThemes";

export function ShikiThemePicker() {
  const { resolved, shikiTheme, setShikiTheme } = useTheme();
  const { open, setOpen, containerRef } = useDropdown();

  const themes = SHIKI_THEMES.filter((t) => t.type === resolved);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="シンタックステーマ"
        className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
      >
        <Palette size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl w-56 max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-gh-text-muted border-b border-gh-border">
            {resolved === "dark" ? "Dark テーマ" : "Light テーマ"}
          </div>
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setShikiTheme(t.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                shikiTheme === t.id
                  ? "bg-gh-bg-tertiary text-gh-text-primary font-medium"
                  : "text-gh-text-secondary hover:bg-gh-bg-tertiary hover:text-gh-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
