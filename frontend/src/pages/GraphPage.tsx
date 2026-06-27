import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as d3 from "d3";
import { graphApi } from "../lib/api";
import { GraphNodeData, GraphNodeType } from "../lib/types";
import { Share2, X, Link2, Trash2, Maximize2, RotateCcw, RefreshCw, Layers, Search } from "lucide-react";
import { useTheme } from "../lib/theme";
import { Button, IconButton, Badge } from "../components/ui";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: GraphNodeType;
  importance?: number;
  entity_type?: string;
}
interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  relationship?: string;
  kind?: "object" | "entity";
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const TYPE_VARS: Record<GraphNodeType, string> = {
  collection: "--accent",
  user_memory: "--info",
  agent_memory: "--violet",
  kb_entry: "--success",
  entity: "--text-muted",
};

const TYPE_LABEL: Record<GraphNodeType, string> = {
  collection: "Collection",
  user_memory: "Memory",
  agent_memory: "Agent memory",
  kb_entry: "Knowledge",
  entity: "Entity",
};

const ALL_TYPES = Object.keys(TYPE_VARS) as GraphNodeType[];

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const nodeSelRef = useRef<any>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [linkSrc, setLinkSrc] = useState<string | null>(null);
  const [linkDst, setLinkDst] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [visible, setVisible] = useState<Record<GraphNodeType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((t) => [t, true])) as Record<GraphNodeType, boolean>
  );
  const qc = useQueryClient();
  const { resolved } = useTheme();

  const graph = useQuery({ queryKey: ["graph", "full"], queryFn: () => graphApi.full(true) });

  const reindex = useMutation({
    mutationFn: (mode: "additive" | "full") => graphApi.reindex(mode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });
  const createLink = useMutation({
    mutationFn: ({ src, dst }: { src: string; dst: string }) => graphApi.createLink({ source_id: src, target_id: dst }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["graph", "full"] }); setLinkSrc(null); setLinkDst(null); },
  });
  const deleteLink = useMutation({
    mutationFn: ({ src, dst }: { src: string; dst: string }) => graphApi.deleteLink(src, dst),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["graph", "full"] }); },
  });
  const clearLinks = useMutation({
    mutationFn: (id: string) => graphApi.clearLinks(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["graph", "full"] }); },
  });

  // Neighbors of the selected object, derived from the loaded graph edges.
  // Deduplicated by id so a node shared via multiple paths shows up once.
  const neighbors = useMemo(() => {
    if (!selected || !graph.data) return [] as { id: string; label: string }[];
    const byId = new Map(graph.data.nodes.map((n) => [n.id, n]));
    const dedup = new Map<string, { id: string; label: string }>();
    for (const e of graph.data.edges) {
      const s = e.source as string, t = e.target as string;
      if (s === selected.id && byId.has(t)) dedup.set(t, { id: t, label: byId.get(t)!.label });
      else if (t === selected.id && byId.has(s)) dedup.set(s, { id: s, label: byId.get(s)!.label });
    }
    return [...dedup.values()];
  }, [selected, graph.data]);

  const handleSelect = useCallback((node: GraphNode) => {
    setSelected(node);
    if (node.type !== "entity") {
      setLinkSrc((prevSrc) => { if (prevSrc && prevSrc !== node.id) setLinkDst(node.id); return prevSrc; });
    }
  }, []);

  const toggleType = (t: GraphNodeType) => setVisible((v) => ({ ...v, [t]: !v[t] }));

  useEffect(() => {
    if (!svgRef.current || !graph.data) return;

    const colors = Object.fromEntries(ALL_TYPES.map((k) => [k, cssVar(TYPE_VARS[k])])) as Record<GraphNodeType, string>;
    const textColor = cssVar("--text-primary");
    const edgeColor = cssVar("--border-strong");
    const entityEdgeColor = cssVar("--text-faint");
    const labelBg = cssVar("--surface-1");

    const allNodes = graph.data.nodes.filter((n) => visible[n.type]);
    const nodeIds = new Set(allNodes.map((n) => n.id));
    const nodes: GraphNode[] = allNodes.map((o: GraphNodeData) => ({
      id: o.id, label: o.label, type: o.type, importance: o.importance, entity_type: o.entity_type,
    }));
    const edges: GraphLink[] = graph.data.edges
      .filter((e) => nodeIds.has(e.source as string) && nodeIds.has(e.target as string))
      .map((e) => ({ source: e.source as string, target: e.target as string, relationship: e.relationship, kind: e.kind }));

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const { width, height } = svgRef.current.getBoundingClientRect();
    const W = width || 800, H = height || 600;

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 3]).on("zoom", (e) => g.attr("transform", e.transform));
    zoomRef.current = zoom;
    svg.call(zoom as any);

    const g = svg.append("g");

    svg.append("defs").append("marker")
      .attr("id", "mp-arrow").attr("viewBox", "0 -5 10 10").attr("refX", 22)
      .attr("markerWidth", 5).attr("markerHeight", 5).attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", edgeColor);

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(edges).id((d) => d.id).distance((d) => d.kind === "entity" ? 70 : 120))
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(32));

    const link = g.append("g").selectAll("line").data(edges).join("line")
      .attr("stroke", (d) => d.kind === "entity" ? entityEdgeColor : edgeColor)
      .attr("stroke-width", (d) => d.kind === "entity" ? 0.8 : 1.3)
      .attr("stroke-dasharray", (d) => d.kind === "entity" ? "2 3" : null)
      .attr("marker-end", (d) => d.kind === "entity" ? null : "url(#mp-arrow)");

    const node = g.append("g").selectAll("g").data(nodes).join("g")
      .style("cursor", "pointer")
      .call((d3.drag<SVGGElement, GraphNode>()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      ) as any)
      .on("click", (_e, d) => handleSelect(d));

    nodesRef.current = nodes;
    nodeSelRef.current = node;

    node.each(function (d) {
      const el = d3.select(this);
      const color = colors[d.type];
      if (d.type === "collection") {
        el.append("rect").attr("x", -30).attr("y", -13).attr("width", 60).attr("height", 26).attr("rx", 6)
          .attr("fill", labelBg).attr("stroke", color).attr("stroke-width", 2);
      } else if (d.type === "entity") {
        el.append("ellipse").attr("rx", 26).attr("ry", 12).attr("fill", labelBg).attr("stroke", color).attr("stroke-width", 1.4).attr("stroke-dasharray", "3 2");
      } else {
        // size memory/kb nodes subtly by importance (1–5)
        const r = 14 + Math.min(4, Math.max(0, (d.importance ?? 1) - 1)) * 2;
        el.append("circle").attr("r", r).attr("fill", labelBg).attr("stroke", color).attr("stroke-width", 2);
        el.append("circle").attr("r", 6).attr("fill", color);
      }
    });

    node.append("text")
      .text((d) => d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label)
      .attr("text-anchor", "middle").attr("dy", (d) => d.type === "collection" || d.type === "entity" ? "0.35em" : 30)
      .attr("font-size", 10.5).attr("font-weight", 500).attr("fill", textColor).attr("pointer-events", "none");

    sim.on("tick", () => {
      link.attr("x1", (d) => (d.source as GraphNode).x!).attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!).attr("y2", (d) => (d.target as GraphNode).y!);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });
    // Auto-fit once the layout settles so nothing drifts off-screen.
    sim.on("end", () => fitToView());

    return () => { sim.stop(); };
  }, [graph.data, visible, resolved, handleSelect]);

  // Compute the bounding box of all node positions and zoom/pan to contain them.
  const fitToView = useCallback(() => {
    const svg = svgRef.current, zoom = zoomRef.current, nodes = nodesRef.current;
    if (!svg || !zoom || !nodes.length) return;
    const xs = nodes.map((n) => n.x ?? 0), ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const { width, height } = svg.getBoundingClientRect();
    const pad = 80;
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const scale = Math.min(2, Math.max(0.15, Math.min((width - pad) / gw, (height - pad) / gh)));
    const tx = width / 2 - scale * (minX + maxX) / 2;
    const ty = height / 2 - scale * (minY + maxY) / 2;
    d3.select(svg).transition().duration(450).call(
      zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }, []);

  // Highlight nodes matching the search term and pan to the first match.
  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel) return;
    const term = nodeSearch.trim().toLowerCase();
    sel.style("opacity", (d: GraphNode) => !term || d.label.toLowerCase().includes(term) ? 1 : 0.15);
    if (term) {
      const match = nodesRef.current.find((n) => n.label.toLowerCase().includes(term));
      if (match && svgRef.current && zoomRef.current) {
        const { width, height } = svgRef.current.getBoundingClientRect();
        d3.select(svgRef.current).transition().duration(450).call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(width / 2 - (match.x ?? 0) * 1.1, height / 2 - (match.y ?? 0) * 1.1).scale(1.1)
        );
      }
    }
  }, [nodeSearch, graph.data, visible]);

  const counts = graph.data?.counts;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", position: "relative" }}>
      <svg ref={svgRef} style={{ flex: 1, background: "var(--bg-base)", cursor: "grab" }} />

      {/* Node search */}
      <div style={{
        position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 7, background: "var(--surface-1)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "6px 12px",
        boxShadow: "var(--shadow-sm)", minWidth: 230,
      }}>
        <Search size={14} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
        <input value={nodeSearch} onChange={(e) => setNodeSearch(e.target.value)}
          placeholder="Find a node…"
          style={{ flex: 1, border: "none", background: "none", outline: "none", fontSize: 13, color: "var(--text-primary)" }} />
        {nodeSearch && <button onClick={() => setNodeSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", display: "flex" }}><X size={13} /></button>}
      </div>

      {/* Legend + filters */}
      <div style={{
        position: "absolute", top: 16, left: 16,
        background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        padding: "12px 14px", fontSize: 11.5, display: "flex", flexDirection: "column", gap: 7, boxShadow: "var(--shadow-md)", minWidth: 158,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontWeight: 650, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>
          <Layers size={12} /> Filter
        </div>
        {ALL_TYPES.map((type) => (
          <button key={type} onClick={() => toggleType(type)}
            style={{
              display: "flex", alignItems: "center", gap: 8, background: "none", border: "none",
              cursor: "pointer", padding: "1px 0", textAlign: "left", opacity: visible[type] ? 1 : 0.4,
            }}>
            <span style={{
              width: 11, height: 11, flexShrink: 0,
              borderRadius: type === "collection" ? 3 : "50%",
              background: visible[type] ? `var(${TYPE_VARS[type]})` : "var(--surface-2)",
              border: `2px solid var(${TYPE_VARS[type]})`,
              borderStyle: type === "entity" ? "dashed" : "solid",
            }} />
            <span style={{ color: "var(--text-secondary)" }}>{TYPE_LABEL[type]}</span>
          </button>
        ))}
        {counts && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 7, marginTop: 1, color: "var(--text-faint)", fontSize: 10.5 }}>
            {counts.nodes} nodes · {counts.edges} edges
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ position: "absolute", top: 16, right: selected ? 332 : 16, display: "flex", gap: 6, transition: "right var(--motion-base) var(--ease)" }}>
        <div style={{ display: "flex", gap: 2, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 3, boxShadow: "var(--shadow-sm)" }}>
          <IconButton size={30} label="Fit to view" onClick={fitToView}><Maximize2 size={15} /></IconButton>
          <IconButton size={30} label="Re-layout" onClick={() => graph.refetch()}><RotateCcw size={15} /></IconButton>
        </div>
        <div style={{ display: "flex", gap: 2, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 3, boxShadow: "var(--shadow-sm)" }}>
          <Button size="sm" variant="subtle" iconLeft={<RefreshCw size={13} />} loading={reindex.isPending}
            title="Create edges for entries that share entities (incremental)"
            onClick={() => reindex.mutate("additive")}>
            Index edges
          </Button>
          <Button size="sm" variant="ghost"
            title="Wipe and rebuild all shared-entity edges"
            onClick={() => { if (confirm("Full reindex wipes all auto-generated edges and rebuilds them. Continue?")) reindex.mutate("full"); }}>
            Reindex
          </Button>
        </div>
      </div>

      {reindex.isSuccess && (
        <div style={{
          position: "absolute", top: 60, right: selected ? 332 : 16,
          background: "var(--surface-1)", border: "1px solid var(--success)", borderRadius: "var(--radius-md)",
          padding: "6px 12px", fontSize: 12, color: "var(--success)", boxShadow: "var(--shadow-md)",
        }}>
          Reindex queued — track it on the Tasks page
        </div>
      )}

      {/* Link tool bar */}
      {linkSrc && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
          padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-lg)",
        }}>
          <Link2 size={15} color="var(--accent)" />
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {linkSrc.slice(0, 8)}… → {linkDst ? linkDst.slice(0, 8) + "…" : "select target"}
          </span>
          <Button size="sm" variant="success" disabled={!linkDst} loading={createLink.isPending}
            onClick={() => linkSrc && linkDst && createLink.mutate({ src: linkSrc, dst: linkDst })}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setLinkSrc(null); setLinkDst(null); }}>Cancel</Button>
        </div>
      )}

      {/* Side panel */}
      {selected && (
        <div style={{
          width: 316, flexShrink: 0, background: "var(--surface-1)", borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }} className="mp-fade-in">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.label}</span>
            <IconButton size={28} label="Close" onClick={() => setSelected(null)}><X size={15} /></IconButton>
          </div>

          <div style={{ padding: 16, flex: 1, overflow: "auto" }}>
            <div style={{ marginBottom: 16 }}>
              <Badge tone={selected.type === "kb_entry" ? "emerald" : selected.type === "agent_memory" ? "violet" : selected.type === "collection" ? "accent" : selected.type === "entity" ? "neutral" : "info"} dot>
                {selected.type === "entity" && selected.entity_type ? `Entity · ${selected.entity_type}` : TYPE_LABEL[selected.type]}
              </Badge>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, fontFamily: "var(--font-mono)" }}>{selected.id}</div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Connections ({neighbors.length})
            </div>

            {neighbors.length === 0 && <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No connections yet.</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {neighbors.map((n) => (
                <div key={n.id} className="mp-list-item" style={{
                  background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
                  padding: "9px 11px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                }}>
                  <div style={{ minWidth: 0, fontSize: 12.5, fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</div>
                  {selected.type !== "entity" && !n.id.startsWith("entity:") && (
                    <IconButton size={26} label="Unlink" onClick={() => deleteLink.mutate({ src: selected.id, dst: n.id })} style={{ color: "var(--danger)" }}>
                      <Trash2 size={12} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          </div>

          {selected.type !== "entity" && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
              <Button fullWidth variant="subtle" iconLeft={<Link2 size={14} />} onClick={() => setLinkSrc(selected.id)}>
                Link from this node
              </Button>
              {neighbors.some((n) => !n.id.startsWith("entity:")) && (
                <Button fullWidth variant="ghost" iconLeft={<Trash2 size={14} />} loading={clearLinks.isPending}
                  style={{ color: "var(--danger)" }}
                  onClick={() => { if (confirm("Remove all connections from this node? (the node itself stays)")) clearLinks.mutate(selected.id); }}>
                  Remove all connections
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {graph.isLoading && (
        <div style={{
          position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
          padding: "8px 16px", fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 7, boxShadow: "var(--shadow-md)",
        }}>
          <Share2 size={13} /> Loading graph…
        </div>
      )}
    </div>
  );
}
