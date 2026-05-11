import { useEffect, useRef, useState } from "react";

interface CommentFormProps {
  initialBody?: string;
  submitLabel?: string;
  placeholder?: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

export function CommentForm({
  initialBody = "",
  submitLabel = "コメント",
  placeholder = "コメントを入力 (Ctrl+Enter で送信)",
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [body, setBody] = useState(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = body.trim();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="flex flex-col gap-2 p-2 bg-gh-bg-secondary border border-gh-border rounded">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full px-2 py-1.5 text-sm bg-gh-bg-primary border border-gh-border rounded text-gh-text-primary placeholder:text-gh-text-muted resize-y focus:outline-none focus:border-blue-500"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs rounded text-gh-text-secondary hover:bg-gh-bg-tertiary transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={submit}
          disabled={!trimmed}
          className="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
