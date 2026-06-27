import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { proposalsApi, objectsApi, collectionsApi, healthApi, agentsApi } from "../lib/api";
import { ProposalResponse } from "../lib/types";
import { formatDistanceToNow } from "date-fns";
import {
  Check, X, Database, Boxes, GitPullRequest, Cpu, ChevronDown,
  Sparkles, Bot, ArrowRight,
} from "lucide-react";
import { PageContainer } from "../components/Layout";
import { Card, Badge, Button, EmptyState, Skeleton, Divider } from "../components/ui";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const proposals = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => proposalsApi.list("pending") });
  const stats = useQuery({ queryKey: ["objects", "stats"], queryFn: () => objectsApi.list({ page_size: 1 }) });
  const collections = useQuery({ queryKey: ["collections", "flat"], queryFn: () => collectionsApi.list({ flat: "true" }) });
  const health = useQuery({ queryKey: ["health"], queryFn: healthApi.check, refetchInterval: 15_000, staleTime: 0 });
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });

  const approve = useMutation({
    mutationFn: (id: string) => proposalsApi.approve(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["objects"] }); },
  });
  const reject = useMutation({
    mutationFn: (id: string) => proposalsApi.reject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });

  const dbOk = health.data?.database === "ok";

  return (
    <PageContainer>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard
          icon={<Database size={18} />} tone="accent"
          label="Total Objects" value={stats.data?.total} loading={stats.isLoading}
        />
        <StatCard
          icon={<Boxes size={18} />} tone="violet"
          label="Collections" value={collections.data?.length} loading={collections.isLoading}
        />
        <StatCard
          icon={<GitPullRequest size={18} />} tone="amber"
          label="Pending Proposals" value={proposals.data?.length} loading={proposals.isLoading}
        />
        <StatCard
          icon={<Bot size={18} />} tone="cyan"
          label="Active Agents" value={agents.data?.filter((a) => !a.revoked).length} loading={agents.isLoading}
        />
      </div>

      <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        {/* Approval queue */}
        <Card>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)",
          }}>
            <GitPullRequest size={16} color="var(--accent)" />
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>Approval Queue</span>
            {proposals.data && proposals.data.length > 0 && (
              <Badge tone="amber" size="sm">{proposals.data.length}</Badge>
            )}
          </div>

          <div style={{ padding: proposals.data?.length ? 12 : 0 }}>
            {proposals.isLoading && (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1].map((i) => <Skeleton key={i} height={72} radius={10} />)}
              </div>
            )}

            {proposals.data?.length === 0 && (
              <EmptyState
                icon={<Sparkles size={22} />}
                title="All caught up"
                description="No pending proposals. Agent-submitted changes will appear here for your review."
              />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {proposals.data?.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onApprove={() => approve.mutate(p.id)}
                  onReject={() => reject.mutate(p.id)}
                  busy={approve.isPending || reject.isPending}
                />
              ))}
            </div>
          </div>
        </Card>

        {/* Side column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* System status */}
          <Card padding={18}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Cpu size={15} color="var(--text-secondary)" />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>System Status</span>
            </div>

            <StatusLine label="Mode" value={health.data?.mode ? health.data.mode.charAt(0).toUpperCase() + health.data.mode.slice(1) : "—"} tone="accent" />
            <Divider style={{ margin: "12px 0" }} />
            <StatusLine label="Database" value={dbOk ? "Connected" : "Down"} tone={dbOk ? "success" : "muted"} dot />

            {health.data?.inference && (() => {
              const level = health.data.mode_level ?? 0;
              // Which providers are actually used at each mode:
              //   light (1) → none · standard (2) → embedding · advanced (3) → all
              const models = [
                { label: "Embedding", p: health.data.inference.embedding, minLevel: 2 },
                { label: "LLM (entities)", p: health.data.inference.llm, minLevel: 3 },
                { label: "OCR (vision)", p: health.data.inference.ocr, minLevel: 3 },
              ];
              const anyActive = models.some((m) => level >= m.minLevel);
              return (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Models
                  </span>
                  {!anyActive && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      No models used in <strong>light</strong> mode — FTS &amp; graph only.
                    </span>
                  )}
                  {models.map(({ label, p, minLevel }) => {
                    const active = level >= minLevel;
                    // Always show the configured model name — just flag whether it's
                    // used in the current mode (greyed + "advanced only" otherwise).
                    return (
                      <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: active ? "var(--success)" : "var(--border-strong)" }} />
                          {label}
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          {!active && (
                            <span style={{ fontSize: 10, color: "var(--text-faint)", fontStyle: "italic", whiteSpace: "nowrap" }}>
                              {minLevel >= 3 ? "advanced only" : "standard+"}
                            </span>
                          )}
                          <span style={{
                            fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 7px",
                            background: "var(--surface-2)", borderRadius: "var(--radius-sm)",
                            color: active ? "var(--text-secondary)" : "var(--text-faint)",
                            border: "1px solid var(--border-subtle)", opacity: active ? 1 : 0.7,
                            maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={p?.model}>
                            {p?.model || "—"}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </Card>

          {/* Quick actions */}
          <Card padding={18}>
            <span style={{ fontWeight: 600, fontSize: 13.5, display: "block", marginBottom: 12 }}>Quick Actions</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <QuickAction label="Browse user memory" onClick={() => navigate("/user-memory")} />
              <QuickAction label="Search everything" onClick={() => navigate("/search")} />
              <QuickAction label="Review proposals" onClick={() => navigate("/proposals")} />
              <QuickAction label="Explore graph" onClick={() => navigate("/graph")} />
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function StatCard({ icon, label, value, tone, loading }: {
  icon: React.ReactNode; label: string; value?: number | string;
  tone: "accent" | "violet" | "amber" | "cyan"; loading?: boolean;
}) {
  const colorMap = {
    accent: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    violet: { bg: "var(--violet-bg)", fg: "var(--violet)" },
    amber: { bg: "var(--warning-bg)", fg: "var(--warning)" },
    cyan: { bg: "var(--cyan-bg)", fg: "var(--cyan)" },
  }[tone];

  return (
    <Card hoverable padding="18px 20px">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "var(--radius-lg)", flexShrink: 0,
          background: colorMap.bg, color: colorMap.fg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 550, marginBottom: 2 }}>{label}</div>
          {loading
            ? <Skeleton width={48} height={26} />
            : <div style={{ fontSize: 25, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em" }}>{value ?? "—"}</div>
          }
        </div>
      </div>
    </Card>
  );
}

function StatusLine({ label, value, tone, dot }: {
  label: string; value: string; tone: "accent" | "success" | "muted"; dot?: boolean;
}) {
  const color = tone === "accent" ? "var(--accent)" : tone === "success" ? "var(--success)" : "var(--text-muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />}
        {value}
      </span>
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mp-list-item"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 12px", borderRadius: "var(--radius-md)",
        background: "var(--surface-2)", color: "var(--text-secondary)",
        fontSize: 13, fontWeight: 500, textAlign: "left",
      }}
    >
      {label}
      <ArrowRight size={14} />
    </button>
  );
}

function ProposalCard({ proposal, onApprove, onReject, busy }: {
  proposal: ProposalResponse; onApprove: () => void; onReject: () => void; busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = proposal.proposed_data as Record<string, unknown>;
  const content = data.content as string | undefined;
  const title = (data.subject as string) || (data.memory_id as string) || proposal.proposal_type.replace(/_/g, " ");

  return (
    <div style={{
      background: "var(--surface-2)", border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-lg)", padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <Badge tone="amber" size="sm">{proposal.proposal_type.replace(/_/g, " ")}</Badge>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {proposal.proposer_id.slice(0, 8)}… · {formatDistanceToNow(new Date(proposal.created_at))} ago
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: content ? 4 : 0, textTransform: "capitalize" }}>{title}</div>
          {content && (
            <div
              onClick={() => setExpanded(!expanded)}
              style={{
                fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1.55,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: expanded ? "unset" : 2, WebkitBoxOrient: "vertical",
                whiteSpace: "pre-wrap",
              }}
            >
              {content}
            </div>
          )}
          {content && content.length > 120 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              {expanded ? "Show less" : "Show more"}
              <ChevronDown size={12} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
          <Button variant="success" size="sm" onClick={onApprove} disabled={busy} iconLeft={<Check size={14} />}>
            Approve
          </Button>
          <Button variant="danger" size="sm" onClick={onReject} disabled={busy} iconLeft={<X size={14} />}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
