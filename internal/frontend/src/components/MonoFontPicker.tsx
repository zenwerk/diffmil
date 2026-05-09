import { Type } from "lucide-react";
import { useMonoFont } from "../hooks/useMonoFont";
import { useDropdown } from "../hooks/useDropdown";

export function MonoFontPicker() {
  const { fontId, setFontId, fonts } = useMonoFont();
  const { open, setOpen, containerRef } = useDropdown();

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="モノスペースフォント"
        className="p-1.5 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
      >
        <Type size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl w-64">
          <div className="px-3 py-2 text-xs text-gh-text-muted border-b border-gh-border">
            モノスペースフォント
          </div>
          {fonts.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFontId(f.id);
                setOpen(false);
              }}
              style={{ fontFamily: `${f.family}, ui-monospace, monospace` }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                fontId === f.id
                  ? "bg-gh-bg-tertiary text-gh-text-primary"
                  : "text-gh-text-secondary hover:bg-gh-bg-tertiary hover:text-gh-text-primary"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{f.label}</span>
                {f.ligatures && (
                  <span className="text-[10px] text-gh-text-muted px-1.5 py-0.5 rounded bg-gh-bg-primary border border-gh-border">
                    ligatures
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5 text-gh-text-muted">
                const x =&gt; () !== null
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
