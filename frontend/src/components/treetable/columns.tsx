import { BrainCircuit, BookOpen, Bot, FileText, Folder, Pin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ColumnDef } from "./types";
import { Badge } from "../ui";
import { ImportanceRating } from "../ImportanceRating";

const ICON = {
  user_memory: BrainCircuit,
  agent_memory: Bot,
  kb_entry: BookOpen,
} as const;

function titleCol(): ColumnDef {
  return {
    key: "subject",
    label: "Title",
    sortable: true,
    width: "44%",
    render: (o) => {
      const Icon = (ICON as any)[o.object_type] || FileText;
      const title = o.subject || o.content?.slice(0, 80) || "(untitled)";
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, maxWidth: "100%" }}>
          <Icon size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          {o.is_pinned && <Pin size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={title}>
            {title}
          </span>
        </span>
      );
    },
  };
}

function collectionCol(): ColumnDef {
  return {
    key: "collection",
    label: "Collection",
    width: "20%",
    render: (o) => o.collection_name
      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
          <Folder size={13} style={{ color: "var(--text-faint)" }} /> {o.collection_name}
        </span>
      : <span style={{ color: "var(--text-faint)" }}>—</span>,
  };
}

function tagsCol(): ColumnDef {
  return {
    key: "tags",
    label: "Tags",
    width: "18%",
    render: (o) => o.tags?.length
      ? <span style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap", overflow: "hidden" }}>
          {o.tags.slice(0, 2).map((t) => <Badge key={t} tone="neutral" size="sm">{t}</Badge>)}
          {o.tags.length > 2 && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>+{o.tags.length - 2}</span>}
        </span>
      : <span style={{ color: "var(--text-faint)" }}>—</span>,
  };
}

function updatedCol(): ColumnDef {
  return {
    key: "updated_at",
    label: "Updated",
    sortable: true,
    width: "16%",
    render: (o) => <span style={{ color: "var(--text-muted)", fontSize: 12.5 }}>{formatDistanceToNow(new Date(o.updated_at))} ago</span>,
  };
}

// Canonical 5-box importance visual (read-only), shared everywhere.
export function ImportanceBadge({ value }: { value: number }) {
  return <ImportanceRating value={value} size={11} />;
}

function importanceCol(): ColumnDef {
  return {
    key: "importance",
    label: "Importance",
    sortable: true,
    width: "14%",
    render: (o) => <ImportanceBadge value={o.importance} />,
  };
}

function entitiesCol(): ColumnDef {
  return {
    key: "entities",
    label: "Entities",
    width: "18%",
    render: (o) => o.entities?.length
      ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center", color: "var(--text-secondary)", fontSize: 12.5 }}>
          {o.entities.slice(0, 2).map((e) => (
            <span key={e.id} style={{ padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>{e.name}</span>
          ))}
          {o.entities.length > 2 && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>+{o.entities.length - 2}</span>}
        </span>
      : <span style={{ color: "var(--text-faint)" }}>—</span>,
  };
}

export const userMemoryColumns: ColumnDef[] = [titleCol(), collectionCol(), entitiesCol(), updatedCol()];
export const knowledgeColumns: ColumnDef[] = [titleCol(), collectionCol(), importanceCol(), updatedCol()];
export const agentMemoryColumns: ColumnDef[] = [titleCol(), collectionCol(), importanceCol(), updatedCol()];
