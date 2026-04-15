import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "diffmil.theme";

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

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(
    resolveTheme(loadStoredMode()),
  );

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    const r = resolveTheme(newMode);
    applyTheme(r);
    setResolved(r);
  }, []);

  // Apply theme on mount and listen for system theme changes
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

  // shiki theme name corresponding to current resolved theme
  const shikiTheme = resolved === "dark" ? "github-dark" : "github-light";

  return { mode, setMode, resolved, shikiTheme };
}
