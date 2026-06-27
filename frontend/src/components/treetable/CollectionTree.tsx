import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutGrid, Folder, FolderOpen, Bot, Inbox, ChevronRight, ChevronDown,
  Pencil, Trash2, Plus,
} from "lucide-react";
import { collectionsApi, agentsApi } from "../../lib/api";
import { CollectionTreeNode } from "../../lib/types";
import { TreeScope } from "./types";
import { Modal, Button, Input, Textarea, FieldLabel, IconButton } from "../ui";

interface Props {
  scope: TreeScope;
  selectedId: string;            // "all" | "none" | uuid | "agent:<id>" | "agent-none:<id>"
  onSelect: (id: string) => void;
  search: string;
}

export function CollectionTree({ scope, selectedId, onSelect, search }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CollectionTreeNode | null>(null);
  const [creating, setCreating] = useState(false);

  const tree = useQuery({
    queryKey: ["collections", "tree", scope],
    queryFn: () => collectionsApi.list({ scope, flat: "false" }),
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.list,
    enabled: scope === "agent",
  });

  const del = useMutation({
    mutationFn: (id: string) => collectionsApi.delete(id, true),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collections"] }); onSelect("all"); },
  });

  const filterMatch = (name: string) => !search || name.toLowerCase().includes(search.toLowerCase());

  const rootLabel = scope === "kb" ? "All Knowledge" : scope === "agent" ? "All Agent Memory" : "All Memories";

  // agent_id → name lookup
  const agentName = useMemo(() => {
    const m: Record<string, string> = {};
    (agents.data ?? []).forEach((a) => { m[a.id] = a.name; });
    return m;
  }, [agents.data]);

  // group agent collections by agent_id — revoked agents are excluded so a
  // deleted/revoked agent doesn't linger as an empty node.
  const agentGroups = useMemo(() => {
    if (scope !== "agent") return [];
    const active = new Set((agents.data ?? []).filter((a) => !a.revoked).map((a) => a.id));
    const groups: Record<string, CollectionTreeNode[]> = {};
    const walk = (nodes: CollectionTreeNode[]) => {
      for (const n of nodes) {
        const aid = n.agent_id || "unknown";
        (groups[aid] ||= []).push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(tree.data ?? []);
    // include active agents with no collections too
    (agents.data ?? []).filter((a) => !a.revoked).forEach((a) => { groups[a.id] ||= []; });
    return Object.entries(groups).filter(([aid]) => active.has(aid));
  }, [scope, tree.data, agents.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 12px 8px",
      }}>
        <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          {scope === "kb" ? "Knowledge" : scope === "agent" ? "Agents" : "Collections"}
        </span>
        {scope !== "agent" && (
          <IconButton size={24} label="New collection" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </IconButton>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 8px 12px" }}>
        {/* Virtual: All */}
        <Row
          label={rootLabel} icon={<LayoutGrid size={15} />}
          active={selectedId === "all"} depth={0}
          onClick={() => onSelect("all")}
        />

        {scope === "agent" ? (
          /* three-tier: agent → collections + uncategorized */
          agentGroups.map(([aid, colls]) => {
            const visible = colls.filter((c) => filterMatch(c.name));
            return (
              <AgentGroup
                key={aid}
                agentId={aid}
                name={agentName[aid] || (aid === "unknown" ? "Unassigned" : aid.slice(0, 8))}
                collections={visible}
                selectedId={selectedId}
                onSelect={onSelect}
                onEdit={setEditing}
                onDelete={(id) => del.mutate(id)}
              />
            );
          })
        ) : (
          <>
            {(tree.data ?? []).filter((n) => filterMatch(n.name)).map((node) => (
              <TreeNode key={node.id} node={node} depth={1}
                selectedId={selectedId} onSelect={onSelect}
                onEdit={setEditing} onDelete={(id) => del.mutate(id)} />
            ))}
            {/* Virtual: Uncategorized */}
            <Row
              label="Uncategorized" icon={<Inbox size={15} />}
              active={selectedId === "none"} depth={0}
              onClick={() => onSelect("none")}
              muted
            />
          </>
        )}

        {tree.isLoading && (
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
        )}
      </div>

      <CollectionModal
        open={creating || !!editing}
        scope={scope}
        editing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ["collections"] }); }}
      />
    </div>
  );
}

function AgentGroup({ agentId, name, collections, selectedId, onSelect, onEdit, onDelete }: {
  agentId: string; name: string; collections: CollectionTreeNode[];
  selectedId: string; onSelect: (id: string) => void;
  onEdit: (c: CollectionTreeNode) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const allId = `agent:${agentId}`;
  const noneId = `agent-none:${agentId}`;

  return (
    <div>
      <div
        onClick={() => onSelect(allId)}
        className="mp-list-item"
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: "6px 8px",
          borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13,
          color: selectedId === allId ? "var(--accent)" : "var(--text-secondary)",
          background: selectedId === allId ? "var(--accent-soft)" : "transparent",
          fontWeight: selectedId === allId ? 600 : 500,
        }}
      >
        <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={{ display: "flex", opacity: 0.7 }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <Bot size={15} color="var(--violet)" />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </div>
      {open && (
        <>
          {collections.map((c) => (
            <TreeNode key={c.id} node={c} depth={2} selectedId={selectedId}
              onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
          ))}
          <Row label="Uncategorized" icon={<Inbox size={14} />} depth={2} muted
            active={selectedId === noneId} onClick={() => onSelect(noneId)} />
        </>
      )}
    </div>
  );
}

function TreeNode({ node, depth, selectedId, onSelect, onEdit, onDelete }: {
  node: CollectionTreeNode; depth: number; selectedId: string;
  onSelect: (id: string) => void;
  onEdit: (c: CollectionTreeNode) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [hover, setHover] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const active = selectedId === node.id;

  return (
    <div>
      <div
        onClick={() => onSelect(node.id)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="mp-list-item"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px", paddingLeft: 8 + depth * 15,
          borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13,
          color: active ? "var(--accent)" : "var(--text-secondary)",
          background: active ? "var(--accent-soft)" : "transparent",
          fontWeight: active ? 600 : 500,
        }}
      >
        <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{ width: 13, display: "flex", opacity: hasChildren ? 0.7 : 0 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {open && hasChildren ? <FolderOpen size={14} color="var(--accent)" /> : <Folder size={14} color="var(--accent)" />}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        {hover ? (
          <span style={{ display: "flex", gap: 1 }}>
            <IconButton size={20} label="Edit" onClick={(e) => { e.stopPropagation(); onEdit(node); }}><Pencil size={11} /></IconButton>
            <IconButton size={20} label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} style={{ color: "var(--danger)" }}><Trash2 size={11} /></IconButton>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{node.object_count}</span>
        )}
      </div>
      {open && hasChildren && node.children!.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} selectedId={selectedId}
          onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function Row({ label, icon, active, depth, onClick, muted }: {
  label: string; icon: React.ReactNode; active: boolean; depth: number;
  onClick: () => void; muted?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className="mp-list-item"
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "6px 8px", paddingLeft: 8 + depth * 15,
        borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13,
        color: active ? "var(--accent)" : muted ? "var(--text-muted)" : "var(--text-secondary)",
        background: active ? "var(--accent-soft)" : "transparent",
        fontWeight: active ? 600 : 500,
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

function CollectionModal({ open, scope, editing, onClose, onSaved }: {
  open: boolean; scope: TreeScope; editing: CollectionTreeNode | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  // sync when opening
  useMemo(() => {
    if (open) { setName(editing?.name ?? ""); setDesc(editing?.description ?? ""); }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: () => editing
      ? collectionsApi.update(editing.id, { name, description: desc || undefined })
      : collectionsApi.create({ name, description: desc || undefined, scope }),
    onSuccess: onSaved,
  });

  return (
    <Modal open={open} onClose={onClose}
      title={editing ? "Edit Collection" : "New Collection"}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!name} loading={save.isPending} onClick={() => save.mutate()}>
          {editing ? "Save" : "Create"}
        </Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><FieldLabel>Name</FieldLabel><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Collection name" /></div>
        <div><FieldLabel hint="optional">Description</FieldLabel><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
