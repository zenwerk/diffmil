import {
  useState,
  useEffect,
  useCallback,
  useContext,
  createContext,
  createElement,
  type ReactNode,
} from "react";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getThemeById,
} from "../constants/shikiThemes";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "diffmil.theme";
const SHIKI_DARK_KEY = "diffmil.shikiTheme.dark";
const SHIKI_LIGHT_KEY = "diffmil.shikiTheme.light";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function loadStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "system";
}

function loadShikiTheme(key: string, fallback: string, type: "light" | "dark"): string {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const meta = getThemeById(stored);
      if (meta && meta.type === type) return stored;
    }
  } catch {
    // ignore
  }
  return fallback;
}

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolved: ResolvedTheme;
  shikiTheme: string;
  setShikiTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialMode = loadStoredMode();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(initialMode),
  );
  const [darkShiki, setDarkShiki] = useState(() =>
    loadShikiTheme(SHIKI_DARK_KEY, DEFAULT_DARK_THEME, "dark"),
  );
  const [lightShiki, setLightShiki] = useState(() =>
    loadShikiTheme(SHIKI_LIGHT_KEY, DEFAULT_LIGHT_THEME, "light"),
  );

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    const r = resolveTheme(newMode);
    applyTheme(r);
    setResolved(r);
  }, []);

  const setShikiTheme = useCallback(
    (id: string) => {
      const meta = getThemeById(id);
      if (!meta) return;
      if (meta.type === "dark") {
        setDarkShiki(id);
        try {
          localStorage.setItem(SHIKI_DARK_KEY, id);
        } catch {
          // ignore
        }
      } else {
        setLightShiki(id);
        try {
          localStorage.setItem(SHIKI_LIGHT_KEY, id);
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  useEffect(() => {
    const r = resolveTheme(mode);
    applyTheme(r);
    setResolved(r);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") {
        const sys = getSystemTheme();
        applyTheme(sys);
        setResolved(sys);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const shikiTheme = resolved === "dark" ? darkShiki : lightShiki;

  return createElement(
    ThemeContext.Provider,
    { value: { mode, setMode, resolved, shikiTheme, setShikiTheme } },
    children,
  );
}
