import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchApi, collectionsApi, entitiesApi } from "../lib/api";
import { SearchResult } from "../lib/types";
import {
  Search, BrainCircuit, BookOpen, FileText, Zap, SlidersHorizontal, Folder, Tag, Share2, X,
} from "lucide-react";
import { PageContainer } from "../components/Layout";
import { Card, Button, EmptyState, Spinner, ObjectTypeBadge, Input, Select } from "../components/ui";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [collectionFilter, setCollectionFilter] = useState("");        // collection id
  const [entityFilter, setEntityFilter] = useState<{ id: string; name: string } | null>(null);
  const [topK, setTopK] = useState(10);
  const [graphBoost, setGraphBoost] = useState(0.15);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const collections = useQuery({ queryKey: ["collections", "flat", "all"], queryFn: () => collectionsApi.list({ flat: "true" }) });

  const filterCount = typeFilter.length + (collectionFilter ? 1 : 0) + (entityFilter ? 1 : 0);
  const canRun = query.trim().length > 0 || filterCount > 0;

  const search = useMutation({
    mutationFn: (params: Parameters<typeof searchApi.search>[0]) => searchApi.search(params),
    onSuccess: (data) => { setResults(data); setSearched(true); },
  });

  // Build search params from current state, with optional overrides (used by the
  // suggestion chips so they don't race React's async state updates).
  const buildParams = (over?: { collection?: string; entity?: { id: string; name: string } | null }) => {
    const coll = over?.collection !== undefined ? over.collection : collectionFilter;
    const ent = over?.entity !== undefined ? over.entity : entityFilter;
    return {
      q: query, top_k: topK, graph_boost: graphBoost,
      object_types: typeFilter.length ? typeFilter : undefined,
      collection_ids: coll ? [coll] : undefined,
      entity_ids: ent ? [ent.id] : undefined,
    };
  };

  const navigate = useNavigate();
  const run = () => { if (canRun) search.mutate(buildParams()); };
  const toggleType = (t: string) => setTypeFilter((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  // Suggestion chips apply structured filters (not a text query) and run immediately.
  const pickCollection = (id: string) => { setCollectionFilter(id); setEntityFilter(null); setShowFilters(true); search.mutate(buildParams({ collection: id, entity: null })); };
  const pickEntity = (e: { id: string; name: string }) => { setEntityFilter(e); setShowFilters(true); search.mutate(buildParams({ entity: e })); };

  return (
    <PageContainer max={1100}>
      {/* Hero search */}
      <div style={{ textAlign: "center", marginBottom: 22, paddingTop: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <Zap size={20} color="var(--accent)" />
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Hybrid Search</h1>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
          Full-text + semantic vector retrieval, graph-boosted and reranked
        </p>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input
            iconLeft={<Search size={16} />}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Search your memories…"
            style={{ height: 44, fontSize: 14.5 }}
          />
        </div>
        <Button
          variant={showFilters ? "subtle" : "secondary"}
          onClick={() => setShowFilters(!showFilters)}
          iconLeft={<SlidersHorizontal size={15} />}
          style={{ height: 44 }}
        >
          Filters{filterCount > 0 ? ` (${filterCount})` : ""}
        </Button>
        <Button variant="primary" onClick={run} disabled={!canRun} loading={search.isPending} style={{ height: 44, minWidth: 88 }}>
          Search
        </Button>
      </div>

      {/* Active structured filters (collection / entity) */}
      {(collectionFilter || entityFilter) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          {collectionFilter && (
            <ActiveFilter icon={<Folder size={12} />} label={(collections.data ?? []).find((c) => c.id === collectionFilter)?.name || "Collection"}
              onClear={() => { setCollectionFilter(""); search.mutate(buildParams({ collection: "" })); }} />
          )}
          {entityFilter && (
            <ActiveFilter icon={<Share2 size={12} />} label={entityFilter.name}
              onClear={() => { setEntityFilter(null); search.mutate(buildParams({ entity: null })); }} />
          )}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <Card padding={16} style={{ marginBottom: 20 }} className="mp-scale-in">
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                Type
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {["user_memory", "agent_memory", "kb_entry"].map((t) => {
                  const active = typeFilter.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleType(t)}
                      style={{
                        padding: "5px 12px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600,
                        background: active ? "var(--accent)" : "var(--surface-2)",
                        color: active ? "var(--accent-contrast)" : "var(--text-secondary)",
                        border: `1px solid ${active ? "transparent" : "var(--border)"}`,
                        transition: "all var(--motion-fast) var(--ease)",
                      }}
                    >
                      {t.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                Collection
              </span>
              <Select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ minWidth: 170, height: 32 }}>
                <option value="">All collections</option>
                {(collections.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                Results
              </span>
              <div style={{ display: "flex", gap: 5 }}>
                {[5, 10, 20, 50].map((k) => (
                  <button
                    key={k}
                    onClick={() => setTopK(k)}
                    style={{
                      width: 38, height: 30, borderRadius: "var(--radius-md)", fontSize: 12.5, fontWeight: 600,
                      background: topK === k ? "var(--accent-soft)" : "var(--surface-2)",
                      color: topK === k ? "var(--accent)" : "var(--text-secondary)",
                      border: `1px solid ${topK === k ? "var(--accent-ring)" : "var(--border)"}`,
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ minWidth: 220 }}>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Share2 size={12} /> Graph boost
                <span style={{ marginLeft: "auto", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>+{Math.round(graphBoost * 100)}%</span>
              </span>
              <input type="range" min={0} max={0.5} step={0.05} value={graphBoost}
                onChange={(e) => setGraphBoost(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>
                <span>Vector / FTS only</span><span>Graph-weighted</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Results */}
      {search.isPending && (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <Spinner size={22} color="var(--accent)" />
          <p style={{ marginTop: 12, fontSize: 13 }}>Searching across memories…</p>
        </div>
      )}

      {!search.isPending && searched && results.length === 0 && (
        <Card><EmptyState icon={<Search size={22} />} title="No results"
          description={query.trim() ? `Nothing matched "${query}". Try different keywords or filters.` : "Nothing matches these filters."} /></Card>
      )}

      {!search.isPending && results.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 13, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{results.length}</strong>
            {query.trim() ? <>results for <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>"{query}"</span></> : "entries"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((r, i) => (
              <SearchResultCard key={r.id} result={r} rank={i + 1}
                topScore={results[0]?.score || 1}
                onOpen={() => navigate(`/entry/${r.id}`)} />
            ))}
          </div>
        </div>
      )}

      {!searched && !search.isPending && (
        <SearchHint
          onPickCollection={pickCollection}
          onPickEntity={pickEntity}
          onPickText={(q) => { setQuery(q); search.mutate({ ...buildParams(), q }); }}
        />
      )}
    </PageContainer>
  );
}

function SearchResultCard({ result, rank, topScore, onOpen }: { result: SearchResult; rank: number; topScore: number; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = result.object_type === "user_memory" ? BrainCircuit
    : result.object_type === "kb_entry" ? BookOpen : FileText;
  // Raw scores are Reciprocal-Rank-Fusion values (~0.01–0.05), not 0–1 confidences.
  // Normalize relative to the top hit so the bar reflects *relative* match strength.
  const relevance = topScore > 0 ? Math.min(1, result.score / topScore) : 0;
  const pct = Math.round(relevance * 100);
  const scoreColor = relevance > 0.66 ? "var(--success)" : relevance > 0.4 ? "var(--warning)" : "var(--text-muted)";
  // Hide inline attachment tokens from the snippet.
  const text = (result.snippet || result.content || "").replace(/<<attachment:[0-9a-fA-F-]{36}>>/g, "").trim();

  return (
    <Card hoverable padding="14px 16px">
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "var(--radius-md)", flexShrink: 0,
          background: "var(--surface-2)", color: "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11.5, fontWeight: 700,
        }}>{rank}</div>

        <Icon size={16} style={{ marginTop: 4, color: "var(--text-muted)", flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <a onClick={(e) => { e.preventDefault(); onOpen(); }} href={`/entry/${result.id}`}
              style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", cursor: "pointer", textDecoration: "none" }}
              className="mp-link-hover">{result.subject || "(untitled)"}</a>
            <ObjectTypeBadge type={result.object_type} size="sm" />
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}
              title={`Relevance — combined full-text + vector ranking${result.score ? `, graph-boosted (raw RRF ${result.score.toFixed(3)})` : ""}`}>
              <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Relevance</span>
              <div style={{ width: 54, height: 4, borderRadius: 2, background: "var(--surface-3)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: scoreColor, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono)", minWidth: 30, textAlign: "right" }}>
                {pct}%
              </span>
            </div>
          </div>

          {text && (
            <div
              onClick={() => setExpanded(!expanded)}
              style={{
                fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1.6,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: expanded ? "unset" : 3, WebkitBoxOrient: "vertical", whiteSpace: "pre-wrap",
              }}
              dangerouslySetInnerHTML={{ __html: highlight(text) }}
            />
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 9, fontSize: 11.5, color: "var(--text-muted)", flexWrap: "wrap" }}>
            {result.collection_name && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Folder size={12} /> {result.collection_name}
              </span>
            )}
            {result.tags?.length > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Tag size={12} /> {result.tags.slice(0, 3).join(", ")}
              </span>
            )}
            {result.entities?.length > 0 && (
              <span>🔗 {result.entities.slice(0, 3).join(", ")}</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function highlight(s: string): string {
  return s.replace(/<mark>(.*?)<\/mark>/g,
    '<mark style="background:var(--accent-soft);color:var(--accent);border-radius:3px;padding:0 3px;font-weight:600">$1</mark>');
}

function ActiveFilter({ icon, label, onClear }: { icon: React.ReactNode; label: string; onClear: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 11px", borderRadius: "var(--radius-full)", background: "var(--accent-soft)", border: "1px solid var(--accent-ring)", fontSize: 12.5, color: "var(--accent)", fontWeight: 550 }}>
      {icon}{label}
      <button onClick={onClear} aria-label="Clear filter" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", display: "flex", padding: 2 }}>
        <X size={13} />
      </button>
    </span>
  );
}

function SearchHint({ onPickCollection, onPickEntity, onPickText }: {
  onPickCollection: (id: string) => void;
  onPickEntity: (e: { id: string; name: string }) => void;
  onPickText: (q: string) => void;
}) {
  // Suggestions from the user's actual collections + top entities. Clicking one
  // applies a structured FILTER (collection / entity), not a fuzzy text query.
  const collections = useQuery({ queryKey: ["collections", "flat", "all"], queryFn: () => collectionsApi.list({ flat: "true" }) });
  const entities = useQuery({ queryKey: ["entities", "top"], queryFn: () => entitiesApi.list() });

  const collChips = (collections.data ?? []).slice(0, 6);
  const entChips = (entities.data ?? []).slice(0, 10);
  const hasSuggestions = collChips.length > 0 || entChips.length > 0;

  return (
    <div>
      {hasSuggestions ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {collChips.length > 0 && (
            <div>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 9 }}>Browse a collection</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {collChips.map((c) => (
                  <button key={c.id} onClick={() => onPickCollection(c.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: "var(--radius-full)", background: "var(--surface-1)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <Folder size={12} style={{ color: "var(--accent)" }} />{c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entChips.length > 0 && (
            <div>
              <span style={{ fontSize: 11, fontWeight: 650, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 9 }}>By entity</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {entChips.map((e) => (
                  <button key={e.id} onClick={() => onPickEntity({ id: e.id, name: e.name })}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: "var(--radius-full)", background: "var(--surface-1)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <Share2 size={12} style={{ color: "var(--violet)" }} />{e.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["What did I learn recently?", "Meeting notes", "Open questions", "Key decisions"].map((ex) => (
            <button key={ex} onClick={() => onPickText(ex)} className="mp-list-item"
              style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                padding: "11px 14px", borderRadius: "var(--radius-md)",
                background: "var(--surface-1)", border: "1px solid var(--border)",
                fontSize: 13, color: "var(--text-secondary)",
              }}>
              <Search size={13} style={{ flexShrink: 0, color: "var(--text-faint)" }} />
              <span style={{ fontStyle: "italic" }}>{ex}</span>
            </button>
          ))}
        </div>
      )}

      <Card padding={16} style={{ marginTop: 20, background: "var(--accent-soft)", border: "1px solid var(--accent-ring)" }}>
        <p style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)", marginBottom: 6 }}>How search works</p>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Mind Palace fuses <strong>full-text search</strong> with <strong>semantic vector similarity</strong> via
          Reciprocal Rank Fusion, applies a <strong>+15% graph boost</strong> for connected objects, and reranks
          results with a cross-encoder for precision.
        </p>
      </Card>
    </div>
  );
}
