import { useParams, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { proposalsApi, agentsApi } from "../lib/api";
import { ArrowLeft, Check, X, Bot, Calendar, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { PageContainer } from "../components/Layout";
import { Card, Button, Badge, Spinner, EmptyState } from "../components/ui";
import { MarkdownView } from "../components/Markdown";

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const proposal = useQuery({ queryKey: ["proposal", id], queryFn: () => proposalsApi.get(id!), enabled: !!id });
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const agentName = useMemo(() => {
    const m: Record<string, string> = {};
    (agents.data ?? []).forEach((a) => { m[a.id] = a.name; });
    return (pid: string) => m[pid] || `${pid.slice(0, 8)}…`;
  }, [agents.data]);

  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["proposal", id] }); qc.invalidateQueries({ queryKey: ["objects"] }); };
  const approve = useMutation({ mutationFn: () => proposalsApi.approve(id!), onSuccess: done });
  const reject = useMutation({ mutationFn: () => proposalsApi.reject(id!), onSuccess: done });

  if (proposal.isLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={22} color="var(--accent)" /></div>;
  if (!proposal.data) return <PageContainer max={760}><EmptyState title="Not found" description="This proposal doesn't exist." action={<Button onClick={() => navigate("/proposals")}>Back to proposals</Button>} /></PageContainer>;

  const p = proposal.data;
  const data = (p.proposed_data || {}) as Record<string, unknown>;
  const content = (data.content as string) || (data.proposed_content as string) || "";
  const tone = p.status === "approved" ? "emerald" : p.status === "rejected" ? "danger" : "amber";
  const busy = approve.isPending || reject.isPending;

  return (
    <PageContainer max={900}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <Button variant="ghost" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate("/proposals")}>Proposals</Button>
        {p.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="success" iconLeft={<Check size={14} />} disabled={busy} loading={approve.isPending} onClick={() => approve.mutate()}>Approve</Button>
            <Button variant="danger" iconLeft={<X size={14} />} disabled={busy} loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button>
          </div>
        )}
      </div>

      <Card padding={24}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Badge tone={tone as any}>{p.proposal_type.replace(/_/g, " ")}</Badge>
          <Badge tone={tone as any} dot>{p.status}</Badge>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)" }}>
            <Bot size={13} style={{ color: "var(--violet)" }} />
            <span style={{ color: "var(--text-secondary)", fontWeight: 550 }}>{agentName(p.proposer_id)}</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-muted)" }}>
            <Calendar size={13} /> {format(new Date(p.created_at), "MMM d, yyyy · HH:mm")}
          </span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 16 }}>{p.title || "(proposal)"}</h1>

        {p.target_object_id && (
          <button onClick={() => navigate(`/entry/${p.target_object_id}`)} className="mp-list-item"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 16, padding: "7px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-1)", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
            <ExternalLink size={13} style={{ color: "var(--accent)" }} />
            Target: <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{p.target_subject || "view source entry"}</span>
          </button>
        )}

        {p.proposal_type === "create_connection" ? (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 12 }}>Proposed connection</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <LinkItem subject={data.source_subject as string} id={data.source_id as string} navigate={navigate} />
              <Badge tone="violet">{(data.relationship_type as string) || "RELATES_TO"}</Badge>
              <span style={{ color: "var(--text-faint)" }}>→</span>
              <LinkItem subject={data.target_subject as string} id={data.target_id as string} navigate={navigate} />
            </div>
          </div>
        ) : content ? (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 10 }}>Proposed content</span>
            <MarkdownView content={content} />
          </div>
        ) : (
          <pre style={{ fontSize: 12, fontFamily: "var(--font-mono)", background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 14, overflowX: "auto", color: "var(--text-secondary)" }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}

        {p.reviewer_note && (
          <div style={{ marginTop: 16, fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic" }}>
            Reviewer note: {p.reviewer_note}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

function LinkItem({ subject, id, navigate }: { subject?: string; id?: string; navigate: (to: string) => void }) {
  const label = subject || (id ? `${id.slice(0, 8)}…` : "(missing)");
  if (!id) return <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span>;
  return (
    <button onClick={() => navigate(`/entry/${id}`)} className="mp-list-item"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-1)", fontSize: 13, fontWeight: 550, color: "var(--text-primary)", cursor: "pointer", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );
}
