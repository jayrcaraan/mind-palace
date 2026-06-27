import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi, graphApi } from "../lib/api";
import { TaskListItem, TaskEvent } from "../lib/types";
import { formatDistanceToNow, format } from "date-fns";
import {
  Activity, FileText, BrainCircuit, ChevronDown, Check, X, Share2, Cpu,
  Loader2, Clock, GitMerge, ArrowRight, RefreshCw, Sparkles, TrendingDown, Archive, Inbox,
} from "lucide-react";
import { PageContainer } from "../components/Layout";
import { Card, Badge, EmptyState, Skeleton, Spinner, Button, IconButton } from "../components/ui";
import { useNavigate } from "react-router-dom";

const STEP_LABEL: Record<string, string> = {
  parse: "Parse", vision: "Vision OCR", embed: "Embedding",
  ner: "Entity extraction", autolink: "Edge creation", index: "Index", decay: "Importance decay",
};

const TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  document: { label: "document", icon: FileText },
  memory: { label: "memory", icon: BrainCircuit },
  optimize: { label: "optimize", icon: Sparkles },
  reindex: { label: "reindex", icon: RefreshCw },
  proactive_link: { label: "proactive", icon: GitMerge },
  decay: { label: "decay", icon: TrendingDown },
};

const TERMINAL = new Set(["completed", "failed"]);

const INGESTION_TYPES = "document,memory,optimize";
const MAINTENANCE_TYPES = "reindex,proactive_link,decay";

export default function TasksPage() {
  const [view, setView] = useState<"ingestion" | "maintenance">("ingestion");
  const [statusFilter, setStatusFilter] = useState("all");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const groupTypes = view === "ingestion" ? INGESTION_TYPES : MAINTENANCE_TYPES;
  const tasks = useQuery({
    queryKey: ["tasks", view, statusFilter, archived, page],
    queryFn: () => tasksApi.list({
      status: statusFilter === "all" ? undefined : statusFilter,
      task_type: groupTypes,
      archived,
      page, page_size: 25,
    }),
    // Poll fast while work is active; keep a slow heartbeat so a stale snapshot
    // (e.g. a step that looks "running" but already finished) self-heals.
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      return items.some((t) => t.status === "running" || t.status === "queued") ? 2500 : 12000;
    },
  });
  const hasActive = (tasks.data?.items ?? []).some((t) => t.status === "running" || t.status === "queued");
  const stats = useQuery({ queryKey: ["tasks", "stats"], queryFn: tasksApi.stats, refetchInterval: hasActive ? 4000 : false });

  const reindex = useMutation({
    mutationFn: (mode: "additive" | "full") => graphApi.reindex(mode),
    onSuccess: () => { setPage(1); qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });

  const total = tasks.data?.total ?? 0;
  const pages = tasks.data?.pages ?? 1;

  return (
    <PageContainer>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Tasks</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 560 }}>
            Background processing & scheduled maintenance — embedding, entity extraction, automated edge creation, and the daily importance-decay pass, with full execution history.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="subtle" iconLeft={<RefreshCw size={13} />} loading={reindex.isPending}
            title="Create edges for entries sharing entities (incremental)"
            onClick={() => reindex.mutate("additive")}>
            Index edges
          </Button>
          <Button size="sm" variant="ghost"
            title="Wipe & rebuild all shared-entity edges"
            onClick={() => { if (confirm("Full reindex wipes all auto-generated edges and rebuilds them. Continue?")) reindex.mutate("full"); }}>
            Reindex
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <Stat icon={<Activity size={16} />} tone="accent" label="Active Tasks" value={stats.data?.total ?? 0} />
        <Stat icon={<Loader2 size={16} />} tone="amber" label="Running / Queued" value={(stats.data?.by_status?.running ?? 0) + (stats.data?.by_status?.queued ?? 0)} />
        <Stat icon={<Check size={16} />} tone="emerald" label="Completed" value={stats.data?.by_status?.completed ?? 0} />
        <Stat icon={<GitMerge size={16} />} tone="violet" label="Graph Edges" value={stats.data?.total_edges_created ?? 0} />
      </div>

      {/* Section tabs — separate on-demand ingestion from scheduled maintenance */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {([["ingestion", "Ingestion & Events", FileText], ["maintenance", "Core Maintenance", TrendingDown]] as const).map(([v, label, Ic]) => (
          <button key={v} onClick={() => { setView(v); setStatusFilter("all"); setPage(1); }}
            className={`mp-tab ${view === v ? "active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Ic size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status:</span>
        {["all", "queued", "running", "completed", "failed"].map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => { setStatusFilter(s); setPage(1); }} label={s} />
        ))}
        <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
        <FilterChip active={archived} onClick={() => { setArchived(!archived); setPage(1); }}
          label={archived ? "archived" : "active"} icon={archived ? <Archive size={12} /> : <Inbox size={12} />} />
      </div>

      {tasks.isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={60} radius={12} />)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tasks.data?.items.map((t) => <TaskRow key={t.id} task={t} />)}
      </div>

      {!tasks.isLoading && total === 0 && (
        <Card><EmptyState icon={<Cpu size={22} />} title={archived ? "No archived tasks" : "No tasks yet"}
          description={archived ? "Completed tasks older than 7 days are archived here automatically." : "Background processing tasks appear here as you create memories and upload documents."} /></Card>
      )}

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20, alignItems: "center" }}>
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="mp-btn mp-btn-ghost" style={{ padding: "5px 12px", borderRadius: "var(--radius-md)", opacity: page === 1 ? 0.4 : 1 }}>Prev</button>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="mp-btn mp-btn-ghost" style={{ padding: "5px 12px", borderRadius: "var(--radius-md)", opacity: page >= pages ? 0.4 : 1 }}>Next</button>
        </div>
      )}
    </PageContainer>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "accent" | "amber" | "emerald" | "violet" }) {
  const c = { accent: ["var(--accent-soft)", "var(--accent)"], amber: ["var(--warning-bg)", "var(--warning)"], emerald: ["var(--success-bg)", "var(--success)"], violet: ["var(--violet-bg)", "var(--violet)"] }[tone];
  return (
    <Card padding="14px 16px" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: "var(--radius-lg)", flexShrink: 0, background: c[0], color: c[1], display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 550 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</div>
      </div>
    </Card>
  );
}

function FilterChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
      display: "inline-flex", alignItems: "center", gap: 5,
      background: active ? "var(--accent)" : "var(--surface-1)", color: active ? "var(--accent-contrast)" : "var(--text-secondary)",
      border: `1px solid ${active ? "transparent" : "var(--border)"}`,
    }}>{icon}{label}</button>
  );
}

const STATUS_TONE: Record<string, any> = { queued: "neutral", running: "amber", completed: "emerald", failed: "danger" };

function TaskRow({ task }: { task: TaskListItem }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const active = task.status === "running" || task.status === "queued";
  const detail = useQuery({
    queryKey: ["task", task.id],
    queryFn: () => tasksApi.get(task.id),
    enabled: open,
    refetchInterval: open ? (active ? 1800 : 10000) : false,
  });
  const archive = useMutation({
    mutationFn: () => tasksApi.archive(task.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });
  const meta = TYPE_META[task.task_type] || { label: task.task_type, icon: Cpu };
  const Icon = meta.icon;
  const showProgress = active && (task.progress_percentage ?? 0) > 0 && (task.progress_percentage ?? 0) < 100;

  return (
    <Card padding={0}>
      <div onClick={() => setOpen(!open)} className="mp-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
        <Icon size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.object_subject || "(untitled)"}</span>
            <Badge tone="neutral" size="sm">{meta.label}</Badge>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {task.current_step && active ? `${STEP_LABEL[task.current_step] || task.current_step} · ` : ""}
            {showProgress ? `${task.progress_percentage}% · ` : ""}
            {formatDistanceToNow(new Date(task.created_at))} ago
          </div>
        </div>
        <Badge tone={STATUS_TONE[task.status] || "neutral"} dot={task.status === "running"}>{task.status}</Badge>
        {TERMINAL.has(task.status) && (
          <IconButton size={28} label={task.archived_at ? "Unarchive" : "Archive"}
            onClick={(e) => { e.stopPropagation(); archive.mutate(); }}>
            <Archive size={13} />
          </IconButton>
        )}
        <ChevronDown size={15} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }} />
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: 16, background: "var(--bg-base)" }} className="mp-fade-in">
          {detail.isLoading && <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><Spinner size={18} color="var(--accent)" /></div>}
          {detail.data && <ExecutionHistory events={detail.data.events} error={detail.data.error_message} taskStatus={detail.data.status} />}
        </div>
      )}
    </Card>
  );
}

function ExecutionHistory({ events, error, taskStatus }: { events: TaskEvent[]; error: string | null; taskStatus: string }) {
  const navigate = useNavigate();

  // Collapse to one row per step (latest event wins) so historical "running"
  // entries don't linger with a spinner. If the task is finished, clamp any
  // lingering "running" step to its real outcome.
  const rows = useMemo(() => {
    const m = new Map<string, TaskEvent>();
    for (const e of events) m.set(e.step, e); // events arrive ts-ascending
    const list = [...m.values()];
    const terminal = TERMINAL.has(taskStatus);
    return list.map((e) => terminal && e.status === "running"
      ? { ...e, status: taskStatus === "failed" ? "failed" : "completed" } as TaskEvent
      : e);
  }, [events, taskStatus]);

  if (!rows.length) return <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No events yet.</p>;

  return (
    <div>
      <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 12 }}>
        Execution history
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((e, i) => {
          const c = e.status === "completed" ? "var(--success)" : e.status === "failed" ? "var(--danger)" : e.status === "running" ? "var(--warning)" : e.status === "skipped" ? "var(--text-faint)" : "var(--border-strong)";
          const linked = (e.metadata?.linked as { id: string; subject: string }[]) || [];
          const isEdge = e.step === "autolink";
          return (
            <div key={e.id} style={{ display: "flex", gap: 12, paddingBottom: i === rows.length - 1 ? 0 : 14, position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: `color-mix(in srgb, ${c} 16%, transparent)`, border: `1.5px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", color: c }}>
                  {e.status === "completed" ? <Check size={11} /> : e.status === "failed" ? <X size={11} /> : e.status === "running" ? <Loader2 size={11} className="mp-spin" /> : isEdge ? <Share2 size={10} /> : <Clock size={10} />}
                </div>
                {i < rows.length - 1 && <div style={{ width: 1.5, flex: 1, minHeight: 14, background: "var(--border)" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: isEdge ? "var(--violet)" : "var(--text-primary)" }}>
                    {STEP_LABEL[e.step] || e.step}
                  </span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 550 }}>{e.status}</span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{format(new Date(e.created_at), "HH:mm:ss")}</span>
                </div>
                {e.detail && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>{e.detail}</div>}
                {isEdge && linked.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    {linked.map((l) => (
                      <button key={l.id} onClick={() => navigate(`/entry/${l.id}`)} className="mp-list-item"
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 9px", borderRadius: "var(--radius-md)", fontSize: 12.5, color: "var(--text-secondary)", textAlign: "left", background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
                        <GitMerge size={12} style={{ color: "var(--violet)", flexShrink: 0 }} />
                        <span style={{ color: "var(--violet)", fontWeight: 600 }}>RELATES_TO</span>
                        <ArrowRight size={11} style={{ color: "var(--text-faint)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.subject || l.id.slice(0, 8)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--danger)", fontFamily: "var(--font-mono)" }}>Error: {error}</div>}
    </div>
  );
}
