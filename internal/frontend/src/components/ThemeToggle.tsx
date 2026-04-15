import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemeMode } from "../hooks/useTheme";

const modes: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex items-center gap-0.5 bg-gh-bg-tertiary rounded-md p-0.5">
      {modes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setMode(value)}
          title={label}
          className={`p-1 rounded transition-colors ${
            mode === value
              ? "bg-gh-bg-primary text-gh-text-primary shadow-sm"
              : "text-gh-text-muted hover:text-gh-text-secondary"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
