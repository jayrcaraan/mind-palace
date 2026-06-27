import { useState, useEffect, ReactNode } from "react";
import { Search, PanelLeftClose, PanelLeft, FolderTree, X } from "lucide-react";
import { CollectionTree } from "./CollectionTree";
import { DataTable } from "./DataTable";
import { ResizeHandle } from "./ResizeHandle";
import { ColumnDef, TreeScope } from "./types";
import { useIsMobile } from "../../lib/useMediaQuery";

interface Props {
  scope: TreeScope;
  objectType: string;
  columns: ColumnDef[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function TreeTableLayout({ scope, objectType, columns, title, subtitle, actions }: Props) {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState("all");
  const [treeWidth, setTreeWidth] = useState(() => Number(localStorage.getItem("mp_tree_w")) || 264);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(`mp_tree_collapsed_${scope}`) === "1");
  const [resizing, setResizing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setSelectedId("all"); }, [scope, objectType]);

  const toggleCollapse = () => {
    const n = !collapsed; setCollapsed(n);
    localStorage.setItem(`mp_tree_collapsed_${scope}`, n ? "1" : "0");
  };

  const onSelect = (id: string) => { setSelectedId(id); if (isMobile) setSheetOpen(false); };

  const tree = <CollectionTree scope={scope} selectedId={selectedId} onSelect={onSelect} search={debounced} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)" }}>
      {/* Toolbar */}
      <div style={{
        minHeight: 56, flexShrink: 0, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, padding: "8px 14px",
        borderBottom: "1px solid var(--border)", background: "var(--surface-1)", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={() => isMobile ? setSheetOpen(true) : toggleCollapse()} className="mp-icon-btn"
            style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}
            title={isMobile ? "Collections" : collapsed ? "Show tree" : "Hide tree"}>
            {isMobile ? <FolderTree size={18} /> : collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
          </button>
          {!isMobile && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.2 }}>{title}</div>
              {subtitle && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{subtitle}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: isMobile ? 1 : "unset", minWidth: 0 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", flex: isMobile ? 1 : "unset" }}>
            <Search size={15} style={{ position: "absolute", left: 11, color: "var(--text-muted)", pointerEvents: "none" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…"
              style={{ width: isMobile ? "100%" : 220, height: 34, paddingLeft: 34, fontSize: 13 }} />
          </div>
          {actions}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Desktop inline tree */}
        {!isMobile && (
          <>
            <div style={{
              width: collapsed ? 0 : treeWidth, flexShrink: 0, overflow: "hidden",
              borderRight: collapsed ? "none" : "1px solid var(--border)", background: "var(--surface-1)",
              transition: resizing ? "none" : "width var(--motion-base) var(--ease)",
            }}>
              <div style={{ width: treeWidth, height: "100%" }}>{tree}</div>
            </div>
            {!collapsed && (
              <ResizeHandle onResize={(w) => setTreeWidth(w)}
                onResizeStart={() => setResizing(true)}
                onResizeEnd={() => { setResizing(false); localStorage.setItem("mp_tree_w", String(treeWidth)); }} />
            )}
          </>
        )}

        {/* Table */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <DataTable scope={scope} objectType={objectType} columns={columns} selectedId={selectedId} search={debounced} mobile={isMobile} />
        </div>

        {/* Mobile tree sheet */}
        {isMobile && sheetOpen && (
          <>
            <div onClick={() => setSheetOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(8,10,14,0.5)", backdropFilter: "blur(2px)", animation: "mp-fade-in var(--motion-fast) var(--ease)" }} />
            <div style={{
              position: "absolute", top: 0, bottom: 0, left: 0, width: "82%", maxWidth: 320, zIndex: 50,
              background: "var(--surface-1)", borderRight: "1px solid var(--border)", boxShadow: "var(--shadow-xl)",
              display: "flex", flexDirection: "column", animation: "mp-slide-in var(--motion-base) var(--ease-out)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
                <button onClick={() => setSheetOpen(false)} className="mp-icon-btn" style={{ padding: 5, borderRadius: 6, color: "var(--text-muted)" }}><X size={17} /></button>
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>{tree}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
