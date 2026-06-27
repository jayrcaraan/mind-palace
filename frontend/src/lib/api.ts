import type {
  CollectionTreeNode, CollectionResponse,
  ObjectResponse, ObjectListResponse,
  ProposalResponse, AgentResponse, AgentTokenResponse,
  IngestAccepted, HealthResponse,
  SearchResult,
} from "./types";

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── Collections ──────────────────────────────────────────────────────────────
export const collectionsApi = {
  list: (params?: Record<string, string>): Promise<CollectionTreeNode[]> =>
    request(`/collections?${new URLSearchParams(params).toString()}`),
  create: (body: {
    name: string;
    description?: string;
    scope?: string;
    parent_collection_id?: string;
  }): Promise<CollectionResponse> =>
    request("/collections", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: object): Promise<CollectionResponse> =>
    request(`/collections/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id: string, cascade = false): Promise<{ deleted: boolean }> =>
    request(`/collections/${id}?cascade=${cascade}`, { method: "DELETE" }),
};

// ── Objects ──────────────────────────────────────────────────────────────────
export const objectsApi = {
  list: (params?: {
    page?: number;
    page_size?: number;
    collection_id?: string;
    object_type?: string;
    contributor_id?: string;
    q?: string;
    sort?: string;
    is_pinned?: boolean;
  }): Promise<ObjectListResponse> => {
    const p: Record<string, string> = {};
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) p[k] = String(v);
      });
    }
    return request(`/objects?${new URLSearchParams(p).toString()}`);
  },
  get: (id: string): Promise<ObjectResponse> => request(`/objects/${id}`),
  create: (body: {
    subject?: string;
    content?: string;
    object_type: string;
    collection_id?: string;
    tags?: string[];
    entities?: { name: string; type?: string }[];
    importance?: number;
    is_pinned?: boolean;
    language?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ObjectResponse> =>
    request("/objects", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: object): Promise<ObjectResponse> =>
    request(`/objects/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id: string): Promise<{ deleted: boolean }> =>
    request(`/objects/${id}`, { method: "DELETE" }),
  optimize: (id: string): Promise<{ task_id: string; status: string }> =>
    request(`/objects/${id}/optimize`, { method: "POST" }),
};

// ── Entities ─────────────────────────────────────────────────────────────────
export const entitiesApi = {
  list: (q?: string): Promise<import("./types").EntitySuggestion[]> =>
    request(`/entities${q ? `?q=${encodeURIComponent(q)}` : ""}`),
};

// ── Tasks (background processing) ─────────────────────────────────────────────
export const tasksApi = {
  list: (params?: { status?: string; task_type?: string; archived?: boolean; page?: number; page_size?: number }):
    Promise<import("./types").TaskListResponse> => {
    const p: Record<string, string> = {};
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) p[k] = String(v); });
    return request(`/tasks?${new URLSearchParams(p).toString()}`);
  },
  get: (id: string): Promise<import("./types").TaskDetail> => request(`/tasks/${id}`),
  stats: (): Promise<import("./types").TaskStats> => request(`/tasks/stats`),
  archive: (id: string): Promise<{ archived: boolean }> =>
    request(`/tasks/${id}/archive`, { method: "POST" }),
};

// ── Search ───────────────────────────────────────────────────────────────────
export const searchApi = {
  search: (params: {
    q?: string;
    top_k?: number;
    graph_boost?: number;
    object_types?: string[];
    collection_ids?: string[];
    entity_ids?: string[];
  }): Promise<SearchResult[]> => {
    const p: Record<string, string> = { q: params.q || "" };
    if (params.top_k) p.limit = String(params.top_k);
    if (params.graph_boost !== undefined) p.graph_boost = String(params.graph_boost);
    if (params.collection_ids?.length) p.collection_ids = params.collection_ids.join(",");
    if (params.entity_ids?.length) p.entity_ids = params.entity_ids.join(",");
    if (params.object_types?.length) p.object_types = params.object_types.join(",");
    return request(`/search?${new URLSearchParams(p).toString()}`);
  },
};

// ── Proposals ────────────────────────────────────────────────────────────────
export const proposalsApi = {
  list: (status = "pending"): Promise<ProposalResponse[]> =>
    request(`/proposals?status=${status}`),
  get: (id: string): Promise<ProposalResponse> => request(`/proposals/${id}`),
  create: (body: object): Promise<ProposalResponse> =>
    request("/proposals", { method: "POST", body: JSON.stringify(body) }),
  approve: (id: string, body?: object): Promise<object> =>
    request(`/proposals/${id}/approve`, { method: "POST", body: JSON.stringify(body || {}) }),
  reject: (id: string, body?: object): Promise<object> =>
    request(`/proposals/${id}/reject`, { method: "POST", body: JSON.stringify(body || {}) }),
  withdraw: (id: string): Promise<object> =>
    request(`/proposals/${id}`, { method: "DELETE" }),
};

// ── Agents ───────────────────────────────────────────────────────────────────
export const agentsApi = {
  list: (): Promise<AgentResponse[]> => request("/agents"),
  create: (body: {
    name: string;
    capabilities?: string[];
    description?: string;
  }): Promise<AgentTokenResponse> =>
    request("/agents", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: {
    name?: string;
    description?: string;
    capabilities?: string[];
  }): Promise<AgentResponse> =>
    request(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  revoke: (id: string): Promise<{ revoked: boolean }> =>
    request(`/agents/${id}`, { method: "DELETE" }),
};

// ── Ingestion ────────────────────────────────────────────────────────────────
export const ingestApi = {
  ingest: (
    file: File,
    objectType: string,
    collectionId?: string,
    subject?: string,
  ): Promise<IngestAccepted> => {
    const form = new FormData();
    form.append("file", file);
    form.append("object_type", objectType);
    if (collectionId) form.append("collection_id", collectionId);
    if (subject) form.append("subject", subject);
    return fetch(`${BASE}/ingest`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<IngestAccepted>;
    });
  },
};

// ── Graph ────────────────────────────────────────────────────────────────────
export const graphApi = {
  full: (includeEntities = true): Promise<import("./types").GraphData> =>
    request(`/graph?include_entities=${includeEntities}`),
  reindex: (mode: "additive" | "full"): Promise<{ task_id: string; mode: string }> =>
    request(`/graph/reindex?mode=${mode}`, { method: "POST" }),
  edges: (): Promise<import("./types").GraphEdge[]> =>
    request<{ edges: import("./types").GraphEdge[]; count: number }>(`/graph/edges`).then((d) => d.edges),
  getNeighbors: (objectId: string, relType?: string): Promise<ObjectResponse[]> => {
    const q = relType ? `?relationship_type=${relType}` : "";
    return request<{ neighbors: ObjectResponse[]; count: number }>(
      `/objects/${objectId}/links${q}`
    ).then((d) => d.neighbors);
  },
  createLink: (body: { source_id: string; target_id: string; link_type?: string }): Promise<object> =>
    request(`/objects/${body.source_id}/links`, {
      method: "POST",
      body: JSON.stringify({ target_id: body.target_id, link_type: body.link_type || "related_to" }),
    }),
  deleteLink: (sourceId: string, targetId: string, linkType = "related_to"): Promise<object> =>
    request(`/objects/${sourceId}/links/${targetId}?link_type=${linkType}`, {
      method: "DELETE",
    }),
  clearLinks: (objectId: string): Promise<{ cleared: boolean; edges_removed: number }> =>
    request(`/objects/${objectId}/links`, { method: "DELETE" }),
};

// ── Health ───────────────────────────────────────────────────────────────────
export const healthApi = {
  check: (): Promise<HealthResponse> => request("/health"),
};
