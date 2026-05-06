import { useEffect } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { keys: ["Ctrl", "["], description: "コミットリストの表示/非表示" },
  { keys: ["Ctrl", "]"], description: "ファイルリストの表示/非表示" },
  { keys: ["Ctrl", "J"], description: "次のファイルへスクロール" },
  { keys: ["Ctrl", "K"], description: "前のファイルへスクロール" },
];

interface KeyboardShortcutsHelpProps {
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gh-border">
          <span className="text-sm font-semibold text-gh-text-primary">キーボードショートカット</span>
          <button
            onClick={onClose}
            className="p-1 rounded text-gh-text-muted hover:text-gh-text-primary hover:bg-gh-bg-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={keys.join("+")} className="flex items-center justify-between gap-4">
              <span className="text-sm text-gh-text-secondary">{description}</span>
              <div className="flex items-center gap-1 shrink-0">
                {keys.map((key, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 text-xs font-mono bg-gh-bg-tertiary border border-gh-border rounded text-gh-text-primary">
                      {key}
                    </kbd>
                    {i < keys.length - 1 && (
                      <span className="text-xs text-gh-text-muted">+</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
