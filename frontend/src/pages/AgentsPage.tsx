import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../lib/api";
import { AgentResponse } from "../lib/types";
import {
  Bot, Plus, Trash2, Copy, Check, Shield, AlertTriangle, Terminal, ChevronDown, Settings2, Square, CheckSquare,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageContainer } from "../components/Layout";
import {
  Card, Button, Badge, EmptyState, Skeleton, Modal, FieldLabel, Input,
} from "../components/ui";

const TOKEN_PLACEHOLDER = "<your-agent-token>";

// Capability matrix — granular, non-destructive scopes stored on the agent.
const CAPABILITY_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "read_memory", label: "Read user memory", hint: "search & read your memories" },
  { key: "read_kb", label: "Read knowledge base", hint: "search & read KB documents" },
  { key: "link_nodes", label: "Link nodes", hint: "create edges between existing items (non-destructive)" },
  { key: "write_memory", label: "Write user memory", hint: "create/edit memories directly" },
  { key: "write_kb", label: "Write knowledge base", hint: "publish/edit KB documents" },
];

function CapabilityMatrix({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {CAPABILITY_OPTIONS.map((c) => {
        const on = value.includes(c.key);
        return (
          <button key={c.key} type="button" onClick={() => toggle(c.key)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 9, textAlign: "left", cursor: "pointer",
              padding: "8px 10px", borderRadius: "var(--radius-md)", background: on ? "var(--accent-soft)" : "var(--surface-2)",
              border: `1px solid ${on ? "var(--accent-ring)" : "var(--border)"}`,
            }}>
            {on ? <CheckSquare size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} /> : <Square size={15} style={{ color: "var(--text-faint)", flexShrink: 0, marginTop: 1 }} />}
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 550, color: "var(--text-primary)", display: "block" }}>{c.label}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{c.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function mcpConfigJson(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-host";
  return JSON.stringify(
    {
      mcpServers: {
        "mind-palace": {
          url: `${origin}/mcp/`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** Copy-pasteable MCP server config. Shows the real token once on creation,
 *  a placeholder afterwards (the raw token is never stored). */
function McpConfigBlock({ token, revealed }: { token: string; revealed: boolean }) {
  const [copied, setCopied] = useState(false);
  const json = mcpConfigJson(revealed ? token : TOKEN_PLACEHOLDER);
  const copy = () => { navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--bg-base)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          <Terminal size={12} /> MCP configuration
        </span>
        <button onClick={copy} className="mp-icon-btn" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-sm)", fontSize: 12, color: copied ? "var(--success)" : "var(--text-secondary)" }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "12px 14px", overflowX: "auto", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
        {json}
      </pre>
    </div>
  );
}

export default function AgentsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AgentResponse | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const revoke = useMutation({
    mutationFn: (id: string) => agentsApi.revoke(id),
    onSuccess: () => {
      // Revoking purges the agent's private memory, so refresh affected views too.
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["objects"] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const active = agents.data?.filter((a) => !a.revoked) ?? [];
  const hasWrite = (caps: string[]) => caps.includes("write_memory") || caps.includes("write_kb");
  const writeCount = active.filter((a) => hasWrite(a.capabilities || [])).length;

  return (
    <PageContainer>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Agents</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            API agents connect via bearer tokens or the MCP server. Read-only agents submit proposals for your review; write agents commit directly.
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>New Agent</Button>
      </div>

      {newToken && <TokenBanner token={newToken} onDismiss={() => setNewToken(null)} />}

      {/* Stats */}
      <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        <MiniStat label="Active Agents" value={active.length} />
        <MiniStat label="Write-enabled" value={writeCount} tone="success" />
        <MiniStat label="Read-only" value={active.length - writeCount} tone="warning" />
      </div>

      {agents.isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1].map((i) => <Skeleton key={i} height={76} radius={12} />)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onEdit={() => setEditing(agent)}
            onRevoke={() => revoke.mutate(agent.id)} revoking={revoke.isPending} />
        ))}
        {!agents.isLoading && active.length === 0 && (
          <Card>
            <EmptyState
              icon={<Bot size={24} />}
              title="No agents yet"
              description="Create an agent to integrate AI tools with your Mind Palace through the MCP server or REST API."
              action={<Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>Create Agent</Button>}
            />
          </Card>
        )}
      </div>

      <CreateAgentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(token) => { setNewToken(token); setShowCreate(false); qc.invalidateQueries({ queryKey: ["agents"] }); }}
      />

      <EditAgentModal
        agent={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["agents"] }); }}
      />
    </PageContainer>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "var(--text-primary)";
  return (
    <Card padding="16px 18px">
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, letterSpacing: "-0.02em" }}>{value}</div>
    </Card>
  );
}

function TokenBanner({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  return (
    <Card padding={16} style={{ marginBottom: 20, background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }} className="mp-scale-in">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <AlertTriangle size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, color: "var(--warning)", marginBottom: 4, fontSize: 13.5 }}>
            Agent created — copy this MCP config now
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 12 }}>
            The token is included below and <strong>won't be shown again</strong>. Paste this into your MCP client config (e.g. Claude Desktop).
          </p>
          <McpConfigBlock token={token} revealed />
        </div>
        <button onClick={onDismiss} className="mp-icon-btn" style={{ color: "var(--text-muted)", padding: 4, borderRadius: 6 }}>✕</button>
      </div>
    </Card>
  );
}

function AgentCard({ agent, onEdit, onRevoke, revoking }: { agent: AgentResponse; onEdit: () => void; onRevoke: () => void; revoking: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const caps = agent.capabilities || [];
  const isWrite = caps.includes("write_memory") || caps.includes("write_kb");
  const tone = isWrite ? "success" : caps.length ? "warning" : "neutral";
  const accessLabel = isWrite ? "write" : caps.length ? "read-only" : "no access";
  const capLabel = (k: string) => CAPABILITY_OPTIONS.find((c) => c.key === k)?.label || k;

  return (
    <Card hoverable padding="15px 16px">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 38, height: 38, borderRadius: "var(--radius-lg)", flexShrink: 0,
          background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Bot size={17} color="var(--accent)" />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{agent.name}</span>
            <Badge tone={tone as any} icon={<Shield size={10} />}>{accessLabel}</Badge>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{agent.id.slice(0, 18)}…</span>
            <span>Created {formatDistanceToNow(new Date(agent.created_at))} ago</span>
            {agent.last_seen_at && <span>Seen {formatDistanceToNow(new Date(agent.last_seen_at))} ago</span>}
          </div>
          {caps.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginTop: 9, flexWrap: "wrap" }}>
              {caps.map((c) => (
                <span key={c} style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: "var(--radius-sm)",
                  background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)",
                }}>{capLabel(c)}</span>
              ))}
            </div>
          )}
          <button onClick={() => setShowConfig(!showConfig)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, fontSize: 12, fontWeight: 550, color: "var(--accent)" }}>
            <Terminal size={12} /> MCP config
            <ChevronDown size={12} style={{ transform: showConfig ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }} />
          </button>
        </div>

        <div style={{ flexShrink: 0 }}>
          {confirm ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--danger)", maxWidth: 180, textAlign: "right" }}>Revoke and delete this agent's private memory?</span>
              <Button size="sm" variant="danger" onClick={onRevoke} loading={revoking}>Yes</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="sm" variant="ghost" iconLeft={<Settings2 size={13} />} onClick={onEdit}>Configure</Button>
              <Button size="sm" variant="ghost" iconLeft={<Trash2 size={13} />} onClick={() => setConfirm(true)} style={{ color: "var(--danger)" }}>
                Revoke
              </Button>
            </div>
          )}
        </div>
      </div>

      {showConfig && (
        <div style={{ marginTop: 12 }} className="mp-fade-in">
          <McpConfigBlock token="" revealed={false} />
          <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
            Replace <code className="mp-inline-code">{TOKEN_PLACEHOLDER}</code> with this agent's token (shown only at creation).
          </p>
        </div>
      )}
    </Card>
  );
}

function CreateAgentModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (token: string) => void;
}) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(["read_memory", "read_kb"]);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => agentsApi.create({
      name,
      capabilities: capabilities.length ? capabilities : undefined,
    }),
    onSuccess: (data) => { setName(""); setCapabilities(["read_memory", "read_kb"]); setError(""); onCreated(data.token); },
    onError: (e: any) => setError(e.message || "Failed to create agent"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title="Create New Agent"
      subtitle="Generate a bearer token for an API or MCP integration."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!name} loading={create.isPending} iconLeft={<Terminal size={14} />}>
            Create Agent
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <FieldLabel>Agent Name</FieldLabel>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Researcher" />
        </div>
        <div>
          <FieldLabel hint="what this agent may do">Capabilities</FieldLabel>
          <CapabilityMatrix value={capabilities} onChange={setCapabilities} />
          <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5 }}>
            Agents without a write capability submit changes as proposals for your review.
            Grant a write capability to let them commit directly.
          </p>
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
      </div>
    </Modal>
  );
}

function EditAgentModal({ agent, onClose, onSaved }: {
  agent: AgentResponse | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Sync local form state when a different agent is opened.
  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setCapabilities(agent.capabilities || []);
      setError("");
    }
  }, [agent?.id]);

  const save = useMutation({
    mutationFn: () => agentsApi.update(agent!.id, { name, capabilities }),
    onSuccess: onSaved,
    onError: (e: any) => setError(e.message || "Failed to update agent"),
  });

  return (
    <Modal
      open={!!agent}
      onClose={onClose}
      width={480}
      title="Configure Agent"
      subtitle="Adjust this agent's name, permission level and capabilities."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={!name} loading={save.isPending} iconLeft={<Settings2 size={14} />}>
            Save changes
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <FieldLabel>Agent Name</FieldLabel>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <FieldLabel hint="what this agent may do">Capabilities</FieldLabel>
          <CapabilityMatrix value={capabilities} onChange={setCapabilities} />
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</p>}
      </div>
    </Modal>
  );
}
