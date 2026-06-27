import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Trash2, FolderInput, X, ChevronLeft, ChevronRight,
  Inbox, Pin, Folder,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { objectsApi, collectionsApi } from "../../lib/api";
import { ObjectResponse } from "../../lib/types";
import { ColumnDef, TreeScope } from "./types";
import { ImportanceBadge } from "./columns";
import { Button, Badge, Spinner, EmptyState } from "../ui";

interface Props {
  scope: TreeScope;
  objectType: string;
  columns: ColumnDef[];
  selectedId: string;
  search: string;
  mobile?: boolean;
  onRowClick?: (obj: ObjectResponse) => void;
}

const PAGE_SIZE = 25;

function resolveParams(scope: TreeScope, objectType: string, selectedId: string) {
  const p: any = { object_type: objectType };
  if (selectedId === "all") { /* nothing */ }
  else if (selectedId === "none") p.collection_id = "none";
  else if (selectedId.startsWith("agent-none:")) { p.contributor_id = selectedId.split(":")[1]; p.collection_id = "none"; }
  else if (selectedId.startsWith("agent:")) p.contributor_id = selectedId.split(":")[1];
  else p.collection_id = selectedId;
  return p;
}

export function DataTable({ scope, objectType, columns, selectedId, search, mobile }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated_at:desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  const [sortKey, sortDir] = sort.split(":");

  const params = useMemo(() => resolveParams(scope, objectType, selectedId), [scope, objectType, selectedId]);

  const query = useQuery({
    queryKey: ["objects", "table", params, search, sort, page],
    queryFn: () => objectsApi.list({ ...params, q: search || undefined, sort, page, page_size: PAGE_SIZE }),
  });

  const collections = useQuery({
    queryKey: ["collections", "flat", scope],
    queryFn: () => collectionsApi.list({ scope, flat: "true" }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // reset selection + page when filter changes
  useMemo(() => { setSelected(new Set()); setPage(1); }, [selectedId, search, objectType]);

  const bulkDelete = useMutation({
    mutationFn: async () => { await Promise.allSettled(Array.from(selected).map((id) => objectsApi.delete(id))); },
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["objects"] }); qc.invalidateQueries({ queryKey: ["collections"] }); },
  });
  const bulkMove = useMutation({
    mutationFn: async (colId: string | null) => {
      await Promise.allSettled(Array.from(selected).map((id) => objectsApi.update(id, { collection_id: colId })));
    },
    onSuccess: () => { setSelected(new Set()); setMoveOpen(false); qc.invalidateQueries({ queryKey: ["objects"] }); qc.invalidateQueries({ queryKey: ["collections"] }); },
  });

  const toggleSort = (key: string) => {
    if (sortKey === key) setSort(`${key}:${sortDir === "asc" ? "desc" : "asc"}`);
    else setSort(`${key}:desc`);
  };
  const toggleRow = (id: string) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n);
  };
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mp-fade-in" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 20px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
            <div style={{ position: "relative" }}>
              <Button size="sm" variant="secondary" iconLeft={<FolderInput size={13} />} onClick={() => setMoveOpen(!moveOpen)}>
                Move to…
              </Button>
              {moveOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
                  minWidth: 200, maxHeight: 260, overflow: "auto",
                  background: "var(--surface-raised)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 6,
                }}>
                  <MoveItem label="Remove from collection" onClick={() => bulkMove.mutate(null)} muted />
                  {(collections.data ?? []).map((c) => (
                    <MoveItem key={c.id} label={c.name} onClick={() => bulkMove.mutate(c.id)} />
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" variant="danger" iconLeft={<Trash2 size={13} />} loading={bulkDelete.isPending} onClick={() => bulkDelete.mutate()}>
              Delete
            </Button>
          </div>
          <button onClick={() => setSelected(new Set())} className="mp-icon-btn" style={{ padding: 5, borderRadius: 6, color: "var(--text-muted)" }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Mobile: card list */}
      {mobile ? (
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((obj) => (
            <MobileCard key={obj.id} obj={obj} selected={selected.has(obj.id)}
              onToggle={() => toggleRow(obj.id)} onOpen={() => navigate(`/entry/${obj.id}`)} />
          ))}
          {query.isLoading && <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner size={20} color="var(--accent)" /></div>}
          {!query.isLoading && items.length === 0 && (
            <EmptyState icon={<Inbox size={22} />} title="No items" description={search ? `Nothing matches "${search}".` : "This view is empty."} />
          )}
        </div>
      ) : (
      /* Desktop: table */
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ width: 44, padding: "10px 16px" }}>
                <input type="checkbox" checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent)" }} />
              </th>
              {columns.map((col) => (
                <th key={col.key}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  style={{
                    width: col.width, padding: "10px 16px", textAlign: col.align || "left",
                    fontWeight: 600, color: "var(--text-secondary)", fontSize: 12,
                    cursor: col.sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap",
                  }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {col.label}
                    {col.sortable && (sortKey === col.key
                      ? (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                      : <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((obj) => (
              <tr key={obj.id}
                onClick={() => navigate(`/entry/${obj.id}`)}
                className="mp-row"
                style={{
                  borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
                  background: selected.has(obj.id) ? "var(--accent-soft)" : "transparent",
                }}>
                <td style={{ padding: "11px 16px" }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(obj.id)} onChange={() => toggleRow(obj.id)}
                    style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent)" }} />
                </td>
                {columns.map((col) => (
                  <td key={col.key} style={{
                    padding: "11px 16px", textAlign: col.align || "left",
                    color: "var(--text-primary)", maxWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {col.render(obj)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {query.isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner size={20} color="var(--accent)" /></div>
        )}
        {!query.isLoading && items.length === 0 && (
          <EmptyState icon={<Inbox size={22} />} title="No items" description={search ? `Nothing matches "${search}".` : "This view is empty."} />
        )}
      </div>
      )}

      {/* Pagination footer */}
      {total > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px", borderTop: "1px solid var(--border)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {total} item{total !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)} iconLeft={<ChevronLeft size={14} />}>Prev</Button>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)", minWidth: 60, textAlign: "center" }}>{page} / {pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} iconRight={<ChevronRight size={14} />}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileCard({ obj, selected, onToggle, onOpen }: {
  obj: ObjectResponse; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  return (
    <div onClick={onOpen} style={{
      background: selected ? "var(--accent-soft)" : "var(--surface-1)",
      border: `1px solid ${selected ? "var(--accent-ring)" : "var(--border)"}`,
      borderRadius: "var(--radius-lg)", padding: 14, cursor: "pointer", boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <input type="checkbox" checked={selected} onClick={(e) => e.stopPropagation()} onChange={onToggle}
          style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {obj.subject || "(untitled)"}
            </span>
            {obj.is_pinned && <Pin size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />}
          </div>
          {obj.content && (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {obj.content}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {obj.collection_name && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-secondary)" }}>
                <Folder size={11} style={{ color: "var(--text-faint)" }} /> {obj.collection_name}
              </span>
            )}
            <ImportanceBadge value={obj.importance} />
            <span style={{ fontSize: 11.5, color: "var(--text-faint)", marginLeft: "auto" }}>
              {formatDistanceToNow(new Date(obj.updated_at))} ago
            </span>
          </div>
          {(obj.entities?.length > 0 || obj.tags?.length > 0) && (
            <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
              {obj.entities?.slice(0, 3).map((e) => (
                <span key={e.id} style={{ fontSize: 11, padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>{e.name}</span>
              ))}
              {obj.tags?.slice(0, 2).map((t) => (
                <span key={t} style={{ fontSize: 11, padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--accent-soft)", color: "var(--accent)" }}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoveItem({ label, onClick, muted }: { label: string; onClick: () => void; muted?: boolean }) {
  return (
    <button onClick={onClick} className="mp-list-item" style={{
      display: "block", width: "100%", textAlign: "left", padding: "7px 11px",
      borderRadius: "var(--radius-md)", fontSize: 13,
      color: muted ? "var(--text-muted)" : "var(--text-secondary)",
    }}>
      {label}
    </button>
  );
}
