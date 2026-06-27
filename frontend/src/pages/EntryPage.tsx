import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { objectsApi, graphApi, agentsApi } from "../lib/api";
import {
  ArrowLeft, Trash2, Save, Pencil, Calendar, Folder, Tag as TagIcon, Hash, Link2, Paperclip,
  ChevronLeft, ChevronRight, User, Bot, Plus, X, Search as SearchIcon, Sparkles, Check, Download,
} from "lucide-react";
import { resolveContributor } from "../lib/constants";
import { format } from "date-fns";
import { PageContainer } from "../components/Layout";
import { Card, Button, Badge, ObjectTypeBadge, Spinner, Input, Textarea, FieldLabel, EmptyState } from "../components/ui";
import { EntityInput, EntityValue, EntityChips } from "../components/EntityInput";
import { ImportanceRating } from "../components/ImportanceRating";
import { paginateMarkdown } from "../lib/paginate";
import { MarkdownView } from "../components/Markdown";

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [entities, setEntities] = useState<EntityValue[]>([]);
  const [docPage, setDocPage] = useState(0);
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");

  const obj = useQuery({ queryKey: ["object", id], queryFn: () => objectsApi.get(id!), enabled: !!id });
  const neighbors = useQuery({ queryKey: ["object", id, "links"], queryFn: () => graphApi.getNeighbors(id!), enabled: !!id });
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });

  const linkCandidates = useQuery({
    queryKey: ["objects", "link-picker", linkQuery],
    queryFn: () => objectsApi.list({ q: linkQuery || undefined, page_size: 20 }),
    enabled: !!id && linking,
  });

  const invalidateLinks = () => {
    qc.invalidateQueries({ queryKey: ["object", id, "links"] });
    qc.invalidateQueries({ queryKey: ["graph", "edges"] });
  };
  const addLink = useMutation({
    mutationFn: (targetId: string) => graphApi.createLink({ source_id: id!, target_id: targetId }),
    onSuccess: () => { invalidateLinks(); setLinking(false); setLinkQuery(""); },
  });
  const removeLink = useMutation({
    mutationFn: (targetId: string) => graphApi.deleteLink(id!, targetId),
    onSuccess: invalidateLinks,
  });
  const clearLinks = useMutation({
    mutationFn: () => graphApi.clearLinks(id!),
    onSuccess: invalidateLinks,
  });

  useEffect(() => {
    if (obj.data) {
      setSubject(obj.data.subject || "");
      setContent(obj.data.content || "");
      setTags((obj.data.tags || []).join(", "));
      setEntities((obj.data.entities || []).map((e) => ({ name: e.name, type: e.type })));
      setDocPage(0);
    }
  }, [obj.data?.id]);

  const save = useMutation({
    mutationFn: () => objectsApi.update(id!, {
      subject, content,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      entities,
    }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["object", id] });
      qc.invalidateQueries({ queryKey: ["objects"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
    },
  });

  const del = useMutation({
    mutationFn: () => objectsApi.delete(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["objects"] }); navigate(-1); },
  });

  const optimize = useMutation({
    mutationFn: () => objectsApi.optimize(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });

  const setImportance = useMutation({
    mutationFn: (value: number) => objectsApi.update(id!, { importance: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object", id] });
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });

  // Render attachments inline in the body (v1-style): replace any
  // <<attachment:UUID>> tokens at their position, then append any image
  // attachments that weren't referenced by a token so nothing is hidden.
  const contentWithAttachments = useMemo(() => {
    let c = obj.data?.content || "";
    const atts = obj.data?.attachments || [];
    const byId = new Map(atts.map((a) => [a.id, a]));
    const used = new Set<string>();
    c = c.replace(/<<attachment:([0-9a-fA-F-]{36})>>/g, (_m, aid) => {
      const a = byId.get(aid);
      if (!a) return "";
      used.add(aid);
      const url = `/api/v1/attachments/${aid}/content`;
      return (a.mime_type || "").startsWith("image")
        ? `\n\n![${a.filename}](${url})\n\n`
        : `\n\n[📎 ${a.filename}](${url})\n\n`;
    });
    const extras = atts
      .filter((a) => (a.mime_type || "").startsWith("image") && !used.has(a.id))
      .map((a) => `![${a.filename}](/api/v1/attachments/${a.id}/content)`);
    if (extras.length) c = `${c}\n\n${extras.join("\n\n")}`;
    return c;
  }, [obj.data?.content, obj.data?.attachments]);

  const docPages = useMemo(() => paginateMarkdown(contentWithAttachments), [contentWithAttachments]);
  const totalDocPages = docPages.length;
  const safePage = Math.min(docPage, totalDocPages - 1);

  if (obj.isLoading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={22} color="var(--accent)" /></div>;
  }
  if (!obj.data) {
    return <PageContainer max={760}><EmptyState title="Not found" description="This entry doesn't exist or was deleted." action={<Button onClick={() => navigate(-1)}>Go back</Button>} /></PageContainer>;
  }

  const o = obj.data;

  return (
    <PageContainer max={1500} key={o.id}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <Button variant="ghost" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button>
        <div style={{ display: "flex", gap: 8 }}>
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => { setEditing(false); setSubject(o.subject || ""); setContent(o.content || ""); setTags((o.tags || []).join(", ")); setEntities((o.entities || []).map((e) => ({ name: e.name, type: e.type }))); }}>Cancel</Button>
              <Button variant="primary" iconLeft={<Save size={14} />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            </>
          ) : (
            <>
              <Button variant="subtle" iconLeft={optimize.isSuccess ? <Check size={14} /> : <Sparkles size={14} />}
                loading={optimize.isPending} disabled={optimize.isSuccess} onClick={() => optimize.mutate()}
                title="Re-run enrichment: embed, entity extraction & edge creation">
                {optimize.isSuccess ? "Queued" : "Optimize"}
              </Button>
              <Button variant="secondary" iconLeft={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="danger" iconLeft={<Trash2 size={14} />} loading={del.isPending} onClick={() => del.mutate()}>Delete</Button>
            </>
          )}
        </div>
      </div>

      <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>
        {/* Main */}
        <Card padding={24}>
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div><FieldLabel>Subject</FieldLabel><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
              <div><FieldLabel>Content</FieldLabel><Textarea rows={14} value={content} onChange={(e) => setContent(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.7 }} /></div>
              <div><FieldLabel hint="comma-separated">Tags</FieldLabel><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
              <div><FieldLabel hint="people, places, concepts…">Entities</FieldLabel><EntityInput value={entities} onChange={setEntities} /></div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <ObjectTypeBadge type={o.object_type} />
                {o.is_pinned && <Badge tone="amber" size="sm">Pinned</Badge>}
              </div>
              <h1 style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 16 }}>{o.subject || "(untitled)"}</h1>
              {contentWithAttachments.trim()
                ? <MarkdownView content={docPages[safePage]} />
                : <span style={{ color: "var(--text-faint)" }}>No content.</span>}

              {totalDocPages > 1 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
                }}>
                  <Button size="sm" variant="ghost" iconLeft={<ChevronLeft size={14} />}
                    disabled={safePage === 0} onClick={() => setDocPage(safePage - 1)}>
                    Previous
                  </Button>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      Page {safePage + 1} of {totalDocPages}
                    </span>
                    <div style={{ display: "flex", gap: 3 }}>
                      {docPages.map((_, i) => (
                        <button key={i} onClick={() => setDocPage(i)} aria-label={`Page ${i + 1}`}
                          style={{
                            width: 7, height: 7, borderRadius: "50%", padding: 0,
                            background: i === safePage ? "var(--accent)" : "var(--border-strong)",
                            transition: "background var(--motion-fast) var(--ease)",
                          }} />
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" iconRight={<ChevronRight size={14} />}
                    disabled={safePage >= totalDocPages - 1} onClick={() => setDocPage(safePage + 1)}>
                    Next
                  </Button>
                </div>
              )}
              {(o.tags?.length > 0 || o.entities?.length > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
                  {o.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600, marginRight: 4 }}>TAGS</span>
                      {o.tags.map((t) => <Badge key={t} tone="neutral" icon={<TagIcon size={10} />}>{t}</Badge>)}
                    </div>
                  )}
                  {o.entities?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600, marginRight: 4 }}>ENTITIES</span>
                      <EntityChips entities={o.entities} onClick={(e) => navigate(`/search?q=${encodeURIComponent(e.name)}`)} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Sidebar metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={16}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 12 }}>Details</span>
            {(() => {
              const c = resolveContributor(o.contributor_id, agents.data);
              return (
                <MetaNode icon={c.isAgent ? <Bot size={13} /> : <User size={13} />} label="Contributor">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-primary)", fontWeight: 500, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.isAgent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--violet)", flexShrink: 0 }} />}
                    {c.label}
                  </span>
                </MetaNode>
              );
            })()}
            <Meta icon={<Folder size={13} />} label="Collection" value={o.collection_name || "Uncategorized"} />
            <MetaNode icon={<Hash size={13} />} label="Importance">
              <ImportanceRating value={o.importance} onChange={(v) => setImportance.mutate(v)} busy={setImportance.isPending} />
            </MetaNode>
            <Meta icon={<Calendar size={13} />} label="Created" value={format(new Date(o.created_at), "MMM d, yyyy")} />
            <Meta icon={<Calendar size={13} />} label="Updated" value={format(new Date(o.updated_at), "MMM d, yyyy")} />
            {o.chunk_count > 0 && <Meta icon={<Hash size={13} />} label="Chunks" value={String(o.chunk_count)} />}
          </Card>

          {/* Images render inline in the document body; the sidebar lists only
              non-image files (PDFs, etc.) as downloadable attachments. */}
          {(() => {
            const files = (o.attachments ?? []).filter((a) => !(a.mime_type || "").startsWith("image"));
            if (files.length === 0) return null;
            return (
            <Card padding={16}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <Paperclip size={12} /> Attachments ({files.length})
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {files.map((a) => {
                  const url = `/api/v1/attachments/${a.id}/content`;
                  return (
                    <div key={a.id} className="mp-list-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 7px", borderRadius: "var(--radius-md)" }}>
                      <a href={url} target="_blank" rel="noreferrer" title={a.filename}
                        style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, color: "var(--text-secondary)", textDecoration: "none", fontSize: 12 }}>
                        <Paperclip size={13} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                        <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>· {(a.size_bytes / 1024).toFixed(0)} KB</span>
                      </a>
                      <a href={url} download={a.filename} aria-label="Download"
                        style={{ color: "var(--text-faint)", display: "flex", flexShrink: 0 }}>
                        <Download size={13} />
                      </a>
                    </div>
                  );
                })}
              </div>
            </Card>
            );
          })()}

          <Card padding={16}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
                <Link2 size={12} /> Connections ({neighbors.data?.length ?? 0})
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {!linking && (neighbors.data?.length ?? 0) > 0 && (
                  <Button size="sm" variant="ghost" iconLeft={<Trash2 size={12} />} loading={clearLinks.isPending}
                    style={{ color: "var(--danger)" }}
                    onClick={() => { if (confirm("Remove all connections from this entry?")) clearLinks.mutate(); }}>
                    Clear
                  </Button>
                )}
                <Button size="sm" variant={linking ? "ghost" : "subtle"}
                  iconLeft={linking ? <X size={12} /> : <Plus size={12} />}
                  onClick={() => { setLinking((v) => !v); setLinkQuery(""); }}>
                  {linking ? "Close" : "Link"}
                </Button>
              </div>
            </div>

            {linking && (
              <div style={{ marginBottom: 12 }}>
                <Input placeholder="Search entries to link…" autoFocus
                  value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)}
                  iconLeft={<SearchIcon size={13} />} />
                <div style={{ marginTop: 8, maxHeight: 200, overflow: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                  {(linkCandidates.data?.items ?? [])
                    .filter((c) => c.id !== id && !(neighbors.data ?? []).some((n) => n.id === c.id))
                    .map((c) => (
                      <button key={c.id} disabled={addLink.isPending}
                        onClick={() => addLink.mutate(c.id)}
                        className="mp-list-item"
                        style={{
                          textAlign: "left", fontSize: 12.5, color: "var(--text-secondary)",
                          padding: "7px 9px", borderRadius: "var(--radius-md)", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 7,
                        }}>
                        <Plus size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject || c.object_type}</span>
                      </button>
                    ))}
                  {linkCandidates.isFetching && <span style={{ fontSize: 11.5, color: "var(--text-faint)", padding: "4px 9px" }}>Searching…</span>}
                  {!linkCandidates.isFetching && (linkCandidates.data?.items ?? []).filter((c) => c.id !== id && !(neighbors.data ?? []).some((n) => n.id === c.id)).length === 0 &&
                    <span style={{ fontSize: 11.5, color: "var(--text-faint)", padding: "4px 9px" }}>No entries found.</span>}
                </div>
              </div>
            )}

            {(neighbors.data ?? []).length === 0
              ? !linking && <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No links yet</span>
              : neighbors.data!.map((n) => (
                <div key={n.id} className="mp-list-item"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", padding: "6px 8px", borderRadius: "var(--radius-md)" }}>
                  <span onClick={() => navigate(`/entry/${n.id}`)} style={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {n.subject || n.object_type}
                  </span>
                  <button aria-label="Unlink" disabled={removeLink.isPending}
                    onClick={() => removeLink.mutate(n.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 2, display: "flex", flexShrink: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <MetaNode icon={icon} label={label}>
      <span style={{ color: "var(--text-primary)", fontWeight: 500, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </MetaNode>
  );
}

function MetaNode({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>{icon}{label}</span>
      {children}
    </div>
  );
}
