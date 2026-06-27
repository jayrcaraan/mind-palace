import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../../lib/theme";

export function ThemeToggle({ variant = "segmented" }: { variant?: "segmented" | "icon" }) {
  const { mode, setMode, toggle, resolved } = useTheme();

  if (variant === "icon") {
    return (
      <button
        onClick={toggle}
        aria-label="Toggle theme"
        title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
        className="mp-icon-btn"
        style={{
          width: 34, height: 34, borderRadius: "var(--radius-md)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-secondary)",
        }}
      >
        {resolved === "dark" ? <Moon size={17} /> : <Sun size={17} />}
      </button>
    );
  }

  const options = [
    { key: "light" as const, icon: <Sun size={14} />, label: "Light" },
    { key: "dark" as const, icon: <Moon size={14} />, label: "Dark" },
    { key: "system" as const, icon: <Monitor size={14} />, label: "System" },
  ];

  return (
    <div style={{
      display: "inline-flex", gap: 2, padding: 3,
      background: "var(--surface-2)", borderRadius: "var(--radius-md)",
      border: "1px solid var(--border-subtle)",
    }}>
      {options.map((opt) => {
        const active = mode === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => setMode(opt.key)}
            aria-label={opt.label}
            title={opt.label}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "5px 9px", borderRadius: "var(--radius-sm)",
              fontSize: 12, fontWeight: 550,
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              background: active ? "var(--surface-1)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              transition: "all var(--motion-fast) var(--ease)",
            }}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
