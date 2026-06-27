import { ReactNode } from "react";

type Tone = "neutral" | "accent" | "info" | "violet" | "emerald" | "amber" | "rose" | "cyan" | "success" | "warning" | "danger";

const toneMap: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "var(--surface-2)", fg: "var(--text-secondary)", border: "var(--border)" },
  accent:  { bg: "var(--accent-soft)", fg: "var(--accent)", border: "var(--accent-ring)" },
  info:    { bg: "var(--info-bg)", fg: "var(--info)", border: "var(--info-border)" },
  violet:  { bg: "var(--violet-bg)", fg: "var(--violet)", border: "var(--violet-border)" },
  emerald: { bg: "var(--success-bg)", fg: "var(--success)", border: "var(--success-border)" },
  amber:   { bg: "var(--warning-bg)", fg: "var(--warning)", border: "var(--warning-border)" },
  rose:    { bg: "var(--danger-bg)", fg: "var(--danger)", border: "var(--danger-border)" },
  cyan:    { bg: "var(--cyan-bg)", fg: "var(--cyan)", border: "var(--cyan-border)" },
  success: { bg: "var(--success-bg)", fg: "var(--success)", border: "var(--success-border)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning)", border: "var(--warning-border)" },
  danger:  { bg: "var(--danger-bg)", fg: "var(--danger)", border: "var(--danger-border)" },
};

export function Badge({ tone = "neutral", children, icon, dot, size = "md" }: {
  tone?: Tone; children: ReactNode; icon?: ReactNode; dot?: boolean; size?: "sm" | "md";
}) {
  const t = toneMap[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: dot || icon ? 5 : 0,
      padding: size === "sm" ? "1px 7px" : "2px 9px",
      borderRadius: "var(--radius-full)",
      fontSize: size === "sm" ? 10.5 : 11.5,
      fontWeight: 600,
      lineHeight: 1.6,
      background: t.bg, color: t.fg,
      border: `1px solid ${t.border}`,
      whiteSpace: "nowrap",
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.fg }} />}
      {icon}
      {children}
    </span>
  );
}

/** Maps an object type to a consistent tone + label */
export function ObjectTypeBadge({ type, size }: { type: string; size?: "sm" | "md" }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    user_memory:  { tone: "info",    label: "Memory" },
    agent_memory: { tone: "violet",  label: "Agent" },
    kb_entry:     { tone: "emerald", label: "Knowledge" },
  };
  const m = map[type] || { tone: "neutral" as Tone, label: type };
  return <Badge tone={m.tone} size={size}>{m.label}</Badge>;
}
