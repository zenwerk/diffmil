import { useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

export function Toast({ message, visible, onDismiss }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(onDismiss, 300);
      }, 5000);
      return () => clearTimeout(timer);
    }
    setShow(false);
  }, [visible, onDismiss]);

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
        onClick={() => {
          setShow(false);
          setTimeout(onDismiss, 300);
        }}
        className="ml-2 text-gh-text-muted hover:text-gh-text-primary"
      >
        &times;
      </button>
    </div>
  );
}
