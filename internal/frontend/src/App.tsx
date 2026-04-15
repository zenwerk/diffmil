import { useState, useEffect } from "react";
import type { DiffResponse } from "./types";
import { FileList } from "./components/FileList";
import { DiffViewer } from "./components/DiffViewer";

export function App() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/_/api/diff")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: DiffResponse) => {
        setDiffData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-github-text-muted">
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center text-github-danger">
        Error: {error}
      </div>
    );
  }

  if (!diffData || diffData.files.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center text-github-text-muted">
        No changes to display
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-github-bg-secondary border-b border-github-border px-4 py-2 flex items-center shrink-0">
        <h1 className="text-sm font-semibold text-github-text-primary">
          diffmil
        </h1>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[280px] shrink-0 border-r border-github-border bg-github-bg-secondary overflow-hidden">
          <FileList files={diffData.files} />
        </aside>

        {/* Diff area */}
        <main className="flex-1 overflow-y-auto p-4">
          {diffData.files.map((file) => (
            <DiffViewer key={file.path} file={file} />
          ))}
        </main>
      </div>
    </div>
  );
}
