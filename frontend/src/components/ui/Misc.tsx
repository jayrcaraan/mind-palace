import { ReactNode } from "react";

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "56px 24px", textAlign: "center", gap: 6,
    }}>
      {icon && (
        <div style={{
          width: 56, height: 56, borderRadius: "var(--radius-xl)",
          background: "var(--surface-2)", color: "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10,
        }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
      {description && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360, lineHeight: 1.6 }}>{description}</div>
      )}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ width, height = 16, radius = 6, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties;
}) {
  return <div className="mp-skeleton" style={{ width: width ?? "100%", height, borderRadius: radius, ...style }} />;
}

export function Divider({ vertical, style }: { vertical?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "var(--border)",
      width: vertical ? 1 : "100%",
      height: vertical ? "100%" : 1,
      flexShrink: 0,
      ...style,
    }} />
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span title={label}>{children}</span>;
}

export function StatPill({ label, value, tone = "neutral" }: {
  label: string; value: ReactNode; tone?: "neutral" | "accent" | "success";
}) {
  const color = tone === "accent" ? "var(--accent)" : tone === "success" ? "var(--success)" : "var(--text-primary)";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
