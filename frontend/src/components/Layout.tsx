import { useState, useEffect, ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { proposalsApi } from "../lib/api";
import { useIsMobile } from "../lib/useMediaQuery";
import {
  LayoutDashboard, Search, BrainCircuit, Bot, BookOpen, GitPullRequest,
  Share2, KeyRound, PanelLeftClose, PanelLeft, Command, Menu, X, Activity,
} from "lucide-react";
import { ThemeToggle } from "./ui";

interface NavItem { to: string; icon: typeof Search; label: string; badge?: boolean; }
interface NavSection { heading: string; items: NavItem[]; }

const SECTIONS: NavSection[] = [
  { heading: "Workspace", items: [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/search", icon: Search, label: "Search" },
  ]},
  { heading: "Second Brain", items: [
    { to: "/user-memory", icon: BrainCircuit, label: "User Memory" },
    { to: "/agent-memory", icon: Bot, label: "Agent Memory" },
    { to: "/knowledge", icon: BookOpen, label: "Knowledge Base" },
  ]},
  { heading: "Review", items: [
    { to: "/proposals", icon: GitPullRequest, label: "Proposals", badge: true },
  ]},
  { heading: "System", items: [
    { to: "/graph", icon: Share2, label: "Graph" },
    { to: "/tasks", icon: Activity, label: "Tasks" },
    { to: "/agents", icon: KeyRound, label: "Agents" },
  ]},
];

const FULL_BLEED = ["/user-memory", "/agent-memory", "/knowledge", "/graph"];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard", subtitle: "Overview & approval queue" },
  "/search": { title: "Search", subtitle: "Hybrid semantic + full-text retrieval" },
  "/proposals": { title: "Proposals", subtitle: "Review agent-submitted changes" },
  "/tasks": { title: "Tasks", subtitle: "Background processing & edge creation history" },
  "/agents": { title: "Agents", subtitle: "API access tokens & MCP config" },
};

export default function Layout() {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("mp-sidebar") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pending = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => proposalsApi.list("pending"), refetchInterval: 20_000 });

  useEffect(() => { localStorage.setItem("mp-sidebar", collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]); // close drawer on nav
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); navigate("/search"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [navigate]);

  const isFullBleed = FULL_BLEED.includes(location.pathname);
  const meta = TITLES[location.pathname];
  const pendingCount = pending.data?.length ?? 0;

  // On mobile the sidebar is never "collapsed" (it's a full drawer); width logic only for desktop.
  const showLabels = isMobile ? true : !collapsed;
  const sidebarWidth = isMobile ? 264 : (collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)");

  const sidebar = (
    <aside style={{
      width: sidebarWidth, flexShrink: 0,
      background: "var(--sidebar-bg)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      transition: isMobile ? "transform var(--motion-base) var(--ease)" : "width var(--motion-base) var(--ease)",
      ...(isMobile ? {
        position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 200,
        transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
        boxShadow: mobileOpen ? "var(--shadow-xl)" : "none",
      } : {}),
    }}>
      {/* Brand */}
      <div style={{
        height: "var(--topbar-h)", display: "flex", alignItems: "center",
        padding: showLabels ? "0 18px" : 0, justifyContent: showLabels ? "space-between" : "center",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: "var(--radius-md)", flexShrink: 0,
            background: "linear-gradient(135deg, var(--accent), var(--violet))",
            display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)",
          }}>
            <BrainCircuit size={18} color="#fff" />
          </div>
          {showLabels && <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.02em" }}>Mind Palace</span>}
        </div>
        {showLabels && (
          <button onClick={() => isMobile ? setMobileOpen(false) : setCollapsed(true)} className="mp-icon-btn"
            style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }} title="Close">
            {isMobile ? <X size={17} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 4, overflow: "auto" }}>
        {!showLabels && (
          <button onClick={() => setCollapsed(false)} className="mp-icon-btn"
            style={{ width: 40, height: 36, margin: "0 auto 4px", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }} title="Expand">
            <PanelLeft size={17} />
          </button>
        )}
        {SECTIONS.map((section) => (
          <div key={section.heading} style={{ marginBottom: 2 }}>
            {showLabels && (
              <div style={{ padding: "6px 11px 4px", fontSize: 10.5, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                {section.heading}
              </div>
            )}
            {section.items.map(({ to, icon: Icon, label, badge }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `mp-nav-item ${isActive ? "active" : ""}`}
                style={{ justifyContent: showLabels ? "flex-start" : "center", padding: showLabels ? "8px 11px" : "9px 0" }}
                title={!showLabels ? label : undefined}>
                <Icon size={17} style={{ flexShrink: 0 }} />
                {showLabels && <span style={{ flex: 1 }}>{label}</span>}
                {showLabels && badge && pendingCount > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--warning)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{pendingCount}</span>
                )}
                {!showLabels && badge && pendingCount > 0 && (
                  <span style={{ position: "absolute", top: 5, right: 10, width: 7, height: 7, borderRadius: "50%", background: "var(--warning)" }} />
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", padding: showLabels ? "12px 14px" : "10px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {showLabels ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Theme</span>
            <ThemeToggle />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ThemeToggle variant="icon" />
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg-base)" }}>
      {!isMobile && sidebar}

      {/* Mobile drawer + backdrop */}
      {isMobile && (
        <>
          {sidebar}
          {mobileOpen && (
            <div onClick={() => setMobileOpen(false)} style={{
              position: "fixed", inset: 0, zIndex: 150, background: "rgba(8,10,14,0.5)",
              backdropFilter: "blur(2px)", animation: "mp-fade-in var(--motion-fast) var(--ease)",
            }} />
          )}
        </>
      )}

      {/* Main column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Mobile header (always) OR desktop topbar (centered pages only) */}
        {isMobile ? (
          <header style={{
            height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 12,
            padding: "0 14px", background: "var(--topbar-bg)", backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--border)", zIndex: 10,
          }}>
            <button onClick={() => setMobileOpen(true)} className="mp-icon-btn"
              style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }} aria-label="Menu">
              <Menu size={20} />
            </button>
            <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {meta?.title ?? pageTitleFor(location.pathname)}
            </div>
            <button onClick={() => navigate("/search")} className="mp-icon-btn"
              style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }} aria-label="Search">
              <Search size={18} />
            </button>
          </header>
        ) : !isFullBleed && (
          <header style={{
            height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 14,
            padding: "0 20px", background: "var(--topbar-bg)", backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 650, lineHeight: 1.2 }}>{meta?.title ?? "Mind Palace"}</div>
              {meta?.subtitle && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{meta.subtitle}</div>}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => navigate("/search")} className="mp-search-trigger"
              style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 10px 0 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-muted)", fontSize: 13 }}>
              <Search size={15} />
              <span style={{ minWidth: 80, textAlign: "left" }}>Search…</span>
              <kbd style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 5px", borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-faint)" }}>
                <Command size={9} />K
              </kbd>
            </button>
          </header>
        )}

        <main style={{ flex: 1, overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div key={location.pathname} className="mp-fade-in" style={{ flex: 1, overflow: (isFullBleed && !isMobile) ? "hidden" : "auto", minHeight: 0 }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function pageTitleFor(path: string): string {
  const map: Record<string, string> = {
    "/user-memory": "User Memory", "/agent-memory": "Agent Memory",
    "/knowledge": "Knowledge Base", "/graph": "Graph",
  };
  return map[path] ?? "Mind Palace";
}

export function PageContainer({ children, max = 1480 }: { children: ReactNode; max?: number }) {
  return <div className="mp-page-container" style={{ maxWidth: max, margin: "0 auto", width: "100%" }}>{children}</div>;
}
