import { useEffect, useState, useCallback } from "react";
import { GitCommitHorizontal } from "lucide-react";

const ANIMATION_MS = 300;
const AUTO_DISMISS_MS = 5000;

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

export function Toast({ message, visible, onDismiss }: ToastProps) {
  const [show, setShow] = useState(false);

  const dismiss = useCallback(() => {
    setShow(false);
    setTimeout(onDismiss, ANIMATION_MS);
  }, [onDismiss]);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
      return () => clearTimeout(timer);
    }
    setShow(false);
  }, [visible, dismiss]);

  if (!visible && !show) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border border-gh-border bg-gh-bg-secondary text-gh-text-primary text-sm transition-all duration-300 ${
        show ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      <GitCommitHorizontal size={16} className="text-gh-accent shrink-0" />
      <span>{message}</span>
      <button
        onClick={dismiss}
        className="ml-2 text-gh-text-muted hover:text-gh-text-primary"
      >
        &times;
      </button>
    </div>
  );
}
