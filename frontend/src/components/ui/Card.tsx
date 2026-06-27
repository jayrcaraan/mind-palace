import { CSSProperties, HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: number | string;
  hoverable?: boolean;
  raised?: boolean;
  children: ReactNode;
}

export function Card({ padding = 0, hoverable, raised, children, style, className, ...rest }: CardProps) {
  return (
    <div
      className={`mp-card ${hoverable ? "mp-card-hover" : ""} ${className || ""}`}
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding,
        boxShadow: raised ? "var(--shadow-md)" : "var(--shadow-sm)",
        transition: "border-color var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease), transform var(--motion-base) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)",
    }}>
      {icon && (
        <div style={{
          width: 34, height: 34, borderRadius: "var(--radius-md)", flexShrink: 0,
          background: "var(--accent-soft)", color: "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase",
      color: "var(--text-muted)", ...style,
    }}>
      {children}
    </div>
  );
}
