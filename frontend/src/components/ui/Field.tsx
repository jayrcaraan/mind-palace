import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, forwardRef } from "react";

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 550, color: "var(--text-secondary)" }}>{children}</span>
      {hint && <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: 6 }}>{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  iconLeft?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ iconLeft, style, ...rest }, ref) {
  if (iconLeft) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{ position: "absolute", left: 11, color: "var(--text-muted)", display: "flex", pointerEvents: "none" }}>
          {iconLeft}
        </span>
        <input ref={ref} style={{ width: "100%", paddingLeft: 34, ...style }} {...rest} />
      </div>
    );
  }
  return <input ref={ref} style={{ width: "100%", ...style }} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ style, ...rest }, ref) {
    return <textarea ref={ref} style={{ width: "100%", resize: "vertical", ...style }} {...rest} />;
  }
);

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ style, children, ...rest }, ref) {
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <select
        ref={ref}
        style={{
          width: "100%", appearance: "none", paddingRight: 32, cursor: "pointer", ...style,
        }}
        {...rest}
      >
        {children}
      </select>
      <span style={{
        position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)",
        pointerEvents: "none", color: "var(--text-muted)", fontSize: 10,
      }}>▼</span>
    </div>
  );
});
