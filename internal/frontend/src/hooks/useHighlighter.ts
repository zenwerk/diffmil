import {
  createHighlighter,
  bundledLanguages,
  type ThemedToken,
  type BundledLanguage,
} from "shiki";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
  createElement,
} from "react";

// Highlighter instance shared across the app
type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

interface HighlighterContextValue {
  ready: boolean;
  highlightLines: (
    lines: string[],
    lang: string,
    theme: string,
  ) => ThemedToken[][];
}

const HighlighterContext = createContext<HighlighterContextValue>({
  ready: false,
  highlightLines: () => [],
});

export function useHighlighter() {
  return useContext(HighlighterContext);
}

// Map of file extensions to shiki language IDs
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  mdx: "mdx",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  lua: "lua",
  r: "r",
  scala: "scala",
  dart: "dart",
  zig: "zig",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  tf: "hcl",
  hcl: "hcl",
  proto: "protobuf",
  mod: "ini",
  sum: "text",
};

export function detectLanguage(filePath: string): string {
  const name = filePath.split("/").pop() ?? "";
  const lower = name.toLowerCase();

  // Special filenames
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  if (lower === "go.mod") return "ini";
  if (lower === "go.sum") return "text";

  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return EXT_TO_LANG[ext ?? ""] ?? "text";
}

// Initial languages to preload (common ones)
const PRELOAD_LANGS = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "python",
  "go",
  "rust",
  "java",
  "json",
  "yaml",
  "html",
  "css",
  "bash",
  "markdown",
  "c",
  "cpp",
  "ini",
  "toml",
  "makefile",
  "dockerfile",
];

const THEMES = ["github-dark", "github-light"] as const;

export function HighlighterProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [langVersion, setLangVersion] = useState(0);
  const hlRef = useRef<Highlighter | null>(null);
  const loadedLangs = useRef<Set<string>>(new Set());
  const loadingLangs = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    createHighlighter({
      themes: [...THEMES],
      langs: PRELOAD_LANGS,
    })
      .then((hl) => {
        if (!cancelled) {
          hlRef.current = hl;
          for (const lang of PRELOAD_LANGS) {
            loadedLangs.current.add(lang);
          }
          setReady(true);
        }
      })
      .catch((err) => {
        console.warn("Failed to initialize syntax highlighter:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLanguage = useCallback((lang: string) => {
    if (loadedLangs.current.has(lang) || loadingLangs.current.has(lang)) return;
    if (!(lang in bundledLanguages)) return;

    const hl = hlRef.current;
    if (!hl) return;

    loadingLangs.current.add(lang);
    hl.loadLanguage(lang as BundledLanguage)
      .then(() => {
        loadedLangs.current.add(lang);
        loadingLangs.current.delete(lang);
        setLangVersion((v) => v + 1);
      })
      .catch(() => {
        loadingLangs.current.delete(lang);
      });
  }, []);

  // langVersion in deps ensures a new function reference when a language finishes loading,
  // so consumers' useMemo re-runs without needing to know about langVersion directly.
  const highlightLines = useCallback(
    (lines: string[], lang: string, theme: string): ThemedToken[][] => {
      const hl = hlRef.current;
      if (!hl) return [];

      if (!loadedLangs.current.has(lang)) {
        if (!loadingLangs.current.has(lang)) {
          loadLanguage(lang);
        }
        return [];
      }

      try {
        const code = lines.join("\n");
        const result = hl.codeToTokens(code, {
          lang: lang as BundledLanguage,
          theme: theme as "github-dark" | "github-light",
        });
        return result.tokens;
      } catch {
        return [];
      }
    },
    [loadLanguage, langVersion],
  );

  return createElement(
    HighlighterContext.Provider,
    { value: { ready, highlightLines } },
    children,
  );
}
