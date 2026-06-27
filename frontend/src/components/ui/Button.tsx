import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "subtle";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

const sizeMap: Record<Size, { pad: string; font: number; height: number; gap: number }> = {
  sm: { pad: "0 10px", font: 12.5, height: 30, gap: 6 },
  md: { pad: "0 14px", font: 13.5, height: 36, gap: 7 },
  lg: { pad: "0 18px", font: 14.5, height: 42, gap: 8 },
};

function variantStyle(variant: Variant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return { background: "var(--accent)", color: "var(--accent-contrast)", border: "1px solid transparent" };
    case "secondary":
      return { background: "var(--surface-1)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" };
    case "subtle":
      return { background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid transparent" };
    case "ghost":
      return { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" };
    case "danger":
      return { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" };
    case "success":
      return { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" };
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, iconLeft, iconRight, fullWidth, children, style, disabled, className, ...rest },
  ref
) {
  const s = sizeMap[size];
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={`mp-btn mp-btn-${variant} ${className || ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        padding: s.pad,
        height: s.height,
        fontSize: s.font,
        fontWeight: 550,
        borderRadius: "var(--radius-md)",
        whiteSpace: "nowrap",
        width: fullWidth ? "100%" : undefined,
        opacity: isDisabled ? 0.55 : 1,
        transition: "filter var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease)",
        ...variantStyle(variant),
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={size === "sm" ? 12 : 14} />}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export function Spinner({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        border: `2px solid ${color || "currentColor"}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        display: "inline-block",
        animation: "mp-spin 0.6s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: number;
  active?: boolean;
  label?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 34, active, label, children, style, ...rest }, ref
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-md)",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        background: active ? "var(--accent-soft)" : "transparent",
        transition: "background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease)",
        ...style,
      }}
      className="mp-icon-btn"
      {...rest}
    >
      {children}
    </button>
  );
});
