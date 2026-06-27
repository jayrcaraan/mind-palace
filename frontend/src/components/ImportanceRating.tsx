/**
 * The single, canonical importance control — a 5-box scale used everywhere
 * (entries, memories, tables, proposals). Interactive when `onChange` is given,
 * read-only otherwise.
 */
export const IMPORTANCE_LABELS = ["", "Low", "Normal", "Medium", "High", "Critical"];

export function ImportanceRating({
  value, onChange, busy, size = 13,
}: {
  value: number;
  onChange?: (v: number) => void;
  busy?: boolean;
  size?: number;
}) {
  const interactive = !!onChange;
  const label = IMPORTANCE_LABELS[Math.max(0, Math.min(5, value))] || `Level ${value}`;
  return (
    <div
      title={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, opacity: busy ? 0.5 : 1 }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const box = (
          <span
            style={{
              width: size, height: size, borderRadius: 3, display: "block",
              background: on ? "var(--accent)" : "var(--surface-2)",
              border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
              transition: "background var(--motion-fast) var(--ease)",
            }}
          />
        );
        return interactive ? (
          <button
            key={n} disabled={busy} aria-label={`Set importance ${n}`}
            onClick={(e) => { e.stopPropagation(); onChange!(n); }}
            style={{ padding: 0, background: "none", border: "none", cursor: "pointer", display: "flex" }}
          >
            {box}
          </button>
        ) : (
          <span key={n} style={{ display: "flex" }}>{box}</span>
        );
      })}
    </div>
  );
}
