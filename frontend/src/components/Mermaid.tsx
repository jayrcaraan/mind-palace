import { useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/theme";

// Lazily-loaded mermaid module — kept out of the main bundle; fetched only when
// a document actually contains a diagram.
let _mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  if (!_mermaidPromise) {
    _mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return _mermaidPromise;
}

let _idSeq = 0;

export function Mermaid({ code }: { code: string }) {
  const { resolved } = useTheme();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mmd-${++_idSeq}`);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",     // no script execution from diagram source
          theme: resolved === "dark" ? "dark" : "default",
          fontFamily: "Inter, -apple-system, Segoe UI, sans-serif",
        });
        return mermaid.render(`${idRef.current}-${resolved === "dark" ? "d" : "l"}`, code);
      })
      .then(({ svg }) => { if (!cancelled) { setSvg(svg); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to render diagram"); });
    return () => { cancelled = true; };
  }, [code, resolved]);

  if (error) {
    return (
      <div style={{
        background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
        borderRadius: "var(--radius-md)", padding: 12, fontSize: 12.5, color: "var(--danger)",
        fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap",
      }}>
        Mermaid error: {error}
        {"\n\n"}
        <span style={{ color: "var(--text-muted)" }}>{code}</span>
      </div>
    );
  }

  if (!svg) {
    return (
      <div style={{
        background: "var(--surface-2)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)", padding: 24, margin: "14px 0",
        textAlign: "center", color: "var(--text-muted)", fontSize: 12.5,
      }}>
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="mp-mermaid"
      style={{
        display: "flex", justifyContent: "center",
        background: "var(--surface-2)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)", padding: 16, margin: "14px 0", overflowX: "auto",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
