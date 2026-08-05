import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  WorkerPoolContextProvider,
  useWorkerPool,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
// Vite needs the worker resolved as a URL so it is emitted as a separate
// module chunk; the library ships it as ESM, hence `type: "module"`.
import DiffsWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import { useTheme } from "../hooks/useTheme";

// Languages preloaded into every worker so the first render of a common file
// type does not pay a lazy-load round trip. Kept deliberately small: each
// worker loads every listed grammar at startup, so this list multiplies both
// boot time and per-worker memory. Anything not listed still works; it just
// resolves on demand.
const PRELOAD_LANGS: WorkerInitializationRenderOptions["langs"] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "go",
  "json",
  "markdown",
];

// Keep the pool small: highlighting is bursty and each worker holds its own
// Shiki instance, so more workers mostly buys memory, not throughput.
function poolSize(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(3, cores - 1));
}

// ThemeSync pushes theme changes into the pool. When a worker pool is in use
// the pool owns render options like `theme`, and per-component `options` are
// ignored — so the ShikiThemePicker/ThemeToggle must reach the pool through
// setRenderOptions or the diff body keeps its original colors.
function ThemeSync({ children }: { children: ReactNode }) {
  const pool = useWorkerPool();
  const { darkShikiTheme, lightShikiTheme } = useTheme();

  // The pool was created with the mount-time theme (see highlighterOptions),
  // so the effect's first run would re-send the exact same values to every
  // worker — and setRenderOptions clears the render cache, forcing a pointless
  // re-highlight right after startup. Track what the pool already has and only
  // push actual changes.
  const applied = useRef({ dark: darkShikiTheme, light: lightShikiTheme });

  useEffect(() => {
    if (pool == null) return;
    if (
      applied.current.dark === darkShikiTheme &&
      applied.current.light === lightShikiTheme
    ) {
      return;
    }
    applied.current = { dark: darkShikiTheme, light: lightShikiTheme };
    void pool
      .setRenderOptions({
        theme: { dark: darkShikiTheme, light: lightShikiTheme },
      })
      .catch(() => {
        // A failed theme push leaves the previous colors in place, which is
        // recoverable on the next change; nothing useful to surface here.
      });
  }, [pool, darkShikiTheme, lightShikiTheme]);

  return <>{children}</>;
}

// PierreWorkerPool moves @pierre/diffs syntax highlighting off the main
// thread. Mounted once at the App root so the pool outlives any single diff.
export function PierreWorkerPool({ children }: { children: ReactNode }) {
  const { darkShikiTheme, lightShikiTheme } = useTheme();

  // The pool is created once from the initial values; later theme changes go
  // through ThemeSync's setRenderOptions rather than re-creating workers.
  const poolOptions = useMemo<WorkerPoolOptions>(
    () => ({
      poolSize: poolSize(),
      workerFactory: () => new Worker(DiffsWorkerUrl, { type: "module" }),
    }),
    [],
  );

  const highlighterOptions = useMemo<WorkerInitializationRenderOptions>(
    () => ({
      theme: { dark: darkShikiTheme, light: lightShikiTheme },
      langs: PRELOAD_LANGS,
    }),
    // Intentionally initialization-only: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <ThemeSync>{children}</ThemeSync>
    </WorkerPoolContextProvider>
  );
}
