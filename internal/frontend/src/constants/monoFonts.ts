export interface MonoFontOption {
  id: string;
  label: string;
  // CSS font-family value (without fallback list)
  family: string;
  ligatures: boolean;
}

export const MONO_FONTS: MonoFontOption[] = [
  { id: "fira-code", label: "Fira Code", family: '"Fira Code Variable"', ligatures: true },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: '"JetBrains Mono Variable"', ligatures: true },
  { id: "source-code-pro", label: "Source Code Pro", family: '"Source Code Pro Variable"', ligatures: false },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", family: '"IBM Plex Mono"', ligatures: false },
  { id: "cascadia-code", label: "Cascadia Code", family: '"Cascadia Code Variable"', ligatures: true },
  { id: "monaspace-neon", label: "Monaspace Neon", family: '"Monaspace Neon"', ligatures: true },
  { id: "system", label: "System Mono", family: "ui-monospace", ligatures: false },
];

export const DEFAULT_MONO_FONT = "fira-code";

export function getMonoFontById(id: string): MonoFontOption | undefined {
  return MONO_FONTS.find((f) => f.id === id);
}
