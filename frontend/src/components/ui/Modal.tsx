import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 460 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(8, 10, 14, 0.55)",
        backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        animation: "mp-fade-in var(--motion-fast) var(--ease)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-xl)",
          width, maxWidth: "100%", maxHeight: "90vh",
          display: "flex", flexDirection: "column",
          animation: "mp-scale-in var(--motion-base) var(--ease-out)",
        }}
      >
        {(title || subtitle) && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "18px 20px", borderBottom: "1px solid var(--border-subtle)",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>}
              {subtitle && <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</p>}
            </div>
            <IconButton size={30} label="Close" onClick={onClose}><X size={16} /></IconButton>
          </div>
        )}

        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>{children}</div>

        {footer && (
          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 8,
            padding: "14px 20px", borderTop: "1px solid var(--border-subtle)",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
