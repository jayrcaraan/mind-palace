import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { proposalsApi, agentsApi } from "../lib/api";
import { ProposalResponse } from "../lib/types";
import { formatDistanceToNow } from "date-fns";
import { Inbox, Check, X, ChevronDown, Bot, CheckSquare, Square } from "lucide-react";
import { PageContainer } from "../components/Layout";
import { Card, Button, Badge, EmptyState, Skeleton } from "../components/ui";

type Tab = "pending" | "approved" | "rejected";

export default function ProposalsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("pending");
  const [sel, setSel] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["proposals", tab],
    queryFn: () => proposalsApi.list(tab),
    refetchInterval: tab === "pending" ? 15_000 : false,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const agentName = useMemo(() => {
    const m: Record<string, string> = {};
    (agents.data ?? []).forEach((a) => { m[a.id] = a.name; });
    return (id: string) => m[id] || `${id.slice(0, 8)}…`;
  }, [agents.data]);
  const counts = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => proposalsApi.list("pending") });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["objects"] }); setSel(new Set()); };
  const approve = useMutation({
    mutationFn: (id: string) => proposalsApi.approve(id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => proposalsApi.reject(id),
    onSuccess: invalidate,
  });
  const bulk = useMutation({
    mutationFn: async (action: "approve" | "reject") => {
      const ids = [...sel];
      for (const id of ids) {
        await (action === "approve" ? proposalsApi.approve(id) : proposalsApi.reject(id));
      }
    },
    onSuccess: invalidate,
  });

  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPendingIds = (q.data ?? []).map((p) => p.id);
  const allSelected = allPendingIds.length > 0 && allPendingIds.every((id) => sel.has(id));

  return (
    <PageContainer max={1480}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Proposals</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
          Review changes proposed by agents before they're committed to your memory.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`mp-tab ${tab === t ? "active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, textTransform: "capitalize" }}>
            {t}
            {t === "pending" && counts.data && counts.data.length > 0 && (
              <Badge tone="amber" size="sm">{counts.data.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {q.isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1].map((i) => <Skeleton key={i} height={88} radius={12} />)}
        </div>
      )}

      {/* Bulk action bar */}
      {tab === "pending" && (q.data?.length ?? 0) > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "8px 12px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <button onClick={() => setSel(allSelected ? new Set() : new Set(allPendingIds))}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 550 }}>
            {allSelected ? <CheckSquare size={15} style={{ color: "var(--accent)" }} /> : <Square size={15} style={{ color: "var(--text-faint)" }} />}
            {sel.size > 0 ? `${sel.size} selected` : "Select all"}
          </button>
          {sel.size > 0 && (
            <div style={{ display: "flex", gap: 7, marginLeft: "auto" }}>
              <Button size="sm" variant="success" iconLeft={<Check size={14} />} loading={bulk.isPending} onClick={() => bulk.mutate("approve")}>Approve selected</Button>
              <Button size="sm" variant="danger" iconLeft={<X size={14} />} loading={bulk.isPending} onClick={() => bulk.mutate("reject")}>Reject selected</Button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {q.data?.map((p) => (
          <ProposalCard key={p.id} proposal={p} tab={tab} contributor={agentName(p.proposer_id)}
            selected={sel.has(p.id)} onToggleSelect={() => toggleSel(p.id)}
            onOpen={() => navigate(`/proposals/${p.id}`)}
            onApprove={() => approve.mutate(p.id)} onReject={() => reject.mutate(p.id)}
            busy={approve.isPending || reject.isPending || bulk.isPending} />
        ))}
      </div>

      {q.data && q.data.length === 0 && !q.isLoading && (
        <Card>
          <EmptyState icon={<Inbox size={22} />}
            title={tab === "pending" ? "Nothing to review" : `No ${tab} proposals`}
            description={tab === "pending" ? "Agent-submitted changes will appear here for approval." : `You have no ${tab} proposals yet.`} />
        </Card>
      )}
    </PageContainer>
  );
}

function ProposalCard({ proposal, tab, contributor, selected, onToggleSelect, onOpen, onApprove, onReject, busy }: {
  proposal: ProposalResponse; tab: Tab; contributor: string;
  selected?: boolean; onToggleSelect?: () => void; onOpen?: () => void;
  onApprove: () => void; onReject: () => void; busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = proposal.proposed_data as Record<string, unknown>;
  const content = (data.content as string) || (data.proposed_content as string) || "";
  // Prefer the server-resolved human title; never show a bare UUID.
  const title = proposal.title || (data.subject as string) || proposal.proposal_type.replace(/_/g, " ");

  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        {tab === "pending" && onToggleSelect && (
          <button onClick={onToggleSelect} aria-label="Select proposal"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 2, color: selected ? "var(--accent)" : "var(--text-faint)", display: "flex", flexShrink: 0 }}>
            {selected ? <CheckSquare size={17} /> : <Square size={17} />}
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <Badge tone={proposal.status === "approved" ? "emerald" : proposal.status === "rejected" ? "danger" : "amber"}>
              {proposal.proposal_type.replace(/_/g, " ")}
            </Badge>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
              <Bot size={12} style={{ color: "var(--violet)" }} />
              <span style={{ color: "var(--text-secondary)", fontWeight: 550 }}>{contributor}</span>
              · {formatDistanceToNow(new Date(proposal.created_at))} ago
            </span>
          </div>
          {onOpen ? (
            <a onClick={(e) => { e.preventDefault(); onOpen(); }} href={`/proposals/${proposal.id}`}
              className="mp-link-hover"
              style={{ display: "block", fontWeight: 600, fontSize: 14.5, marginBottom: content ? 5 : 0, color: "var(--text-primary)", textDecoration: "none", cursor: "pointer" }}>{title}</a>
          ) : (
            <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: content ? 5 : 0 }}>{title}</div>
          )}
          {content && (
            <div onClick={() => setExpanded(!expanded)} style={{
              fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1.6,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: expanded ? "unset" : 2, WebkitBoxOrient: "vertical", whiteSpace: "pre-wrap",
            }}>{content}</div>
          )}
          {content && content.length > 130 && (
            <button onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 12, color: "var(--accent)", marginTop: 5, display: "inline-flex", alignItems: "center", gap: 3 }}>
              {expanded ? "Show less" : "Show more"}
              <ChevronDown size={12} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }} />
            </button>
          )}
          {proposal.reviewer_note && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Note: {proposal.reviewer_note}
            </div>
          )}
        </div>

        {tab === "pending" && (
          <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
            <Button size="sm" variant="success" iconLeft={<Check size={14} />} disabled={busy} onClick={onApprove}>Approve</Button>
            <Button size="sm" variant="danger" iconLeft={<X size={14} />} disabled={busy} onClick={onReject}>Reject</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
