import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Tag } from "lucide-react";
import { entitiesApi } from "../lib/api";

export interface EntityValue { name: string; type: string; }

const TYPE_TONE: Record<string, string> = {
  person: "var(--info)", place: "var(--success)", org: "var(--violet)",
  concept: "var(--accent)", event: "var(--warning)", product: "var(--cyan)",
};
function toneFor(type: string) { return TYPE_TONE[type.toLowerCase()] || "var(--text-muted)"; }

export function EntityInput({ value, onChange }: {
  value: EntityValue[];
  onChange: (v: EntityValue[]) => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState("concept");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useQuery({
    queryKey: ["entities", text],
    queryFn: () => entitiesApi.list(text || undefined),
    enabled: focused,
  });

  const filtered = useMemo(() => {
    const have = new Set(value.map((v) => `${v.name.toLowerCase()}|${v.type.toLowerCase()}`));
    return (suggestions.data ?? [])
      .filter((s) => !have.has(`${s.name.toLowerCase()}|${s.type.toLowerCase()}`))
      .slice(0, 6);
  }, [suggestions.data, value]);

  const add = (name: string, t: string) => {
    const n = name.trim();
    if (!n) return;
    if (value.some((v) => v.name.toLowerCase() === n.toLowerCase() && v.type.toLowerCase() === t.toLowerCase())) {
      setText(""); return;
    }
    onChange([...value, { name: n, type: t }]);
    setText("");
    inputRef.current?.focus();
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, padding: "7px 8px",
        background: "var(--field-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
        minHeight: 40, alignItems: "center",
      }}>
        {value.map((ent, i) => (
          <span key={`${ent.name}-${i}`} style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px",
            borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 550,
            background: `color-mix(in srgb, ${toneFor(ent.type)} 12%, transparent)`,
            color: toneFor(ent.type), border: `1px solid color-mix(in srgb, ${toneFor(ent.type)} 30%, transparent)`,
          }}>
            <Tag size={10} />
            {ent.name}
            <span style={{ opacity: 0.6, fontSize: 10 }}>{ent.type}</span>
            <button onClick={() => remove(i)} style={{ display: "flex", color: "inherit", opacity: 0.7 }}><X size={11} /></button>
          </span>
        ))}
        <div style={{ position: "relative", flex: 1, minWidth: 120, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); add(text, type); }
              else if (e.key === "Backspace" && !text && value.length) remove(value.length - 1);
            }}
            placeholder={value.length ? "" : "Add entity…"
            }
            style={{ flex: 1, border: "none", background: "transparent", padding: "2px 0", outline: "none", boxShadow: "none", fontSize: 13, minWidth: 80 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}
            style={{ border: "none", background: "transparent", fontSize: 11.5, color: "var(--text-muted)", padding: "2px 4px", cursor: "pointer", width: "auto", boxShadow: "none" }}>
            {["concept", "person", "place", "org", "event", "product"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {focused && filtered.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, minWidth: 200,
              background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)", padding: 5, maxHeight: 220, overflow: "auto",
            }}>
              {filtered.map((s) => (
                <button key={s.id} onMouseDown={(e) => { e.preventDefault(); add(s.name, s.type); }}
                  className="mp-list-item" style={{
                    display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8,
                    padding: "6px 9px", borderRadius: "var(--radius-md)", fontSize: 12.5, textAlign: "left",
                  }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: toneFor(s.type) }} />
                    {s.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{s.type} · {s.usage}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
        Press Enter to add. Entities power graph links & search.
      </p>
    </div>
  );
}

/** Read-only entity chips for display. */
export function EntityChips({ entities, onClick }: {
  entities: { name: string; type: string }[];
  onClick?: (e: { name: string; type: string }) => void;
}) {
  if (!entities.length) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {entities.map((e, i) => (
        <span key={`${e.name}-${i}`}
          onClick={onClick ? () => onClick(e) : undefined}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px",
            borderRadius: "var(--radius-full)", fontSize: 11.5, fontWeight: 550,
            background: `color-mix(in srgb, ${toneFor(e.type)} 12%, transparent)`,
            color: toneFor(e.type), border: `1px solid color-mix(in srgb, ${toneFor(e.type)} 28%, transparent)`,
            cursor: onClick ? "pointer" : "default",
          }}>
          <Tag size={10} /> {e.name}
        </span>
      ))}
    </span>
  );
}
