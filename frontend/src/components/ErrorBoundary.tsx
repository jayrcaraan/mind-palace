import { Component, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("Mind Palace UI error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-base)", color: "var(--text-primary)", padding: 24,
        }}>
          <div style={{
            maxWidth: 440, textAlign: "center",
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)", padding: 32, boxShadow: "var(--shadow-lg)",
          }}>
            <div style={{
              width: 52, height: 52, margin: "0 auto 18px", borderRadius: "var(--radius-xl)",
              background: "var(--danger-bg)", color: "var(--danger)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
            }}>!</div>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 20 }}>
              The interface hit an unexpected error. Reloading usually fixes it.
            </p>
            <button onClick={() => window.location.reload()} style={{
              padding: "9px 20px", borderRadius: "var(--radius-md)", fontWeight: 600, fontSize: 13.5,
              background: "var(--accent)", color: "var(--accent-contrast)",
            }}>
              Reload
            </button>
            {import.meta.env.DEV && (
              <pre style={{
                marginTop: 18, textAlign: "left", fontSize: 11, color: "var(--text-faint)",
                background: "var(--bg-base)", padding: 12, borderRadius: "var(--radius-md)",
                overflow: "auto", maxHeight: 160,
              }}>
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
