import { useEffect, useState, useCallback } from "react";
import { DEFAULT_MONO_FONT, getMonoFontById, MONO_FONTS } from "../constants/monoFonts";
import { loadFromStorage, saveToStorage } from "../utils/storage";

const STORAGE_KEY = "diffmil.monoFont";

const loadStored = () =>
  loadFromStorage(
    STORAGE_KEY,
    (s) => (getMonoFontById(s) ? s : undefined),
    DEFAULT_MONO_FONT,
  );

function applyFont(id: string) {
  const opt = getMonoFontById(id);
  if (!opt) return;
  const root = document.documentElement;
  root.style.setProperty("--font-mono-active", opt.family);
  root.style.setProperty(
    "--font-mono-feature-settings",
    opt.ligatures ? '"liga" 1, "calt" 1' : "normal",
  );
}

export function useMonoFont() {
  const [fontId, setFontIdState] = useState<string>(loadStored);

  useEffect(() => {
    applyFont(fontId);
  }, [fontId]);

  const setFontId = useCallback((id: string) => {
    if (!getMonoFontById(id)) return;
    saveToStorage(STORAGE_KEY, id);
    setFontIdState(id);
  }, []);

  return { fontId, setFontId, fonts: MONO_FONTS };
}
