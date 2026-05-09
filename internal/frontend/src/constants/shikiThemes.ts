export interface ShikiThemeOption {
  id: string;
  label: string;
  type: "light" | "dark";
}

export const SHIKI_THEMES: ShikiThemeOption[] = [
  // Dark
  { id: "github-dark", label: "GitHub Dark", type: "dark" },
  { id: "github-dark-dimmed", label: "GitHub Dark Dimmed", type: "dark" },
  { id: "dracula", label: "Dracula", type: "dark" },
  { id: "one-dark-pro", label: "One Dark Pro", type: "dark" },
  { id: "monokai", label: "Monokai", type: "dark" },
  { id: "nord", label: "Nord", type: "dark" },
  { id: "tokyo-night", label: "Tokyo Night", type: "dark" },
  { id: "night-owl", label: "Night Owl", type: "dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", type: "dark" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé", type: "dark" },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato", type: "dark" },
  { id: "solarized-dark", label: "Solarized Dark", type: "dark" },
  { id: "vitesse-dark", label: "Vitesse Dark", type: "dark" },
  { id: "vitesse-black", label: "Vitesse Black", type: "dark" },
  { id: "material-theme", label: "Material", type: "dark" },
  { id: "material-theme-darker", label: "Material Darker", type: "dark" },
  { id: "material-theme-ocean", label: "Material Ocean", type: "dark" },
  { id: "material-theme-palenight", label: "Material Palenight", type: "dark" },
  { id: "synthwave-84", label: "SynthWave '84", type: "dark" },
  { id: "ayu-dark", label: "Ayu Dark", type: "dark" },
  { id: "rose-pine", label: "Rosé Pine", type: "dark" },
  { id: "rose-pine-moon", label: "Rosé Pine Moon", type: "dark" },
  { id: "kanagawa-wave", label: "Kanagawa Wave", type: "dark" },
  { id: "kanagawa-dragon", label: "Kanagawa Dragon", type: "dark" },
  { id: "everforest-dark", label: "Everforest Dark", type: "dark" },
  { id: "houston", label: "Houston", type: "dark" },
  { id: "poimandres", label: "Poimandres", type: "dark" },
  { id: "slack-dark", label: "Slack Dark", type: "dark" },
  // Light
  { id: "github-light", label: "GitHub Light", type: "light" },
  { id: "light-plus", label: "Light Plus", type: "light" },
  { id: "one-light", label: "One Light", type: "light" },
  { id: "solarized-light", label: "Solarized Light", type: "light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", type: "light" },
  { id: "vitesse-light", label: "Vitesse Light", type: "light" },
  { id: "material-theme-lighter", label: "Material Lighter", type: "light" },
  { id: "min-light", label: "Min Light", type: "light" },
  { id: "rose-pine-dawn", label: "Rosé Pine Dawn", type: "light" },
  { id: "everforest-light", label: "Everforest Light", type: "light" },
  { id: "kanagawa-lotus", label: "Kanagawa Lotus", type: "light" },
  { id: "snazzy-light", label: "Snazzy Light", type: "light" },
];

export const DEFAULT_DARK_THEME = "github-dark";
export const DEFAULT_LIGHT_THEME = "github-light";

export function getThemeById(id: string): ShikiThemeOption | undefined {
  return SHIKI_THEMES.find((t) => t.id === id);
}
