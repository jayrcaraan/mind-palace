export type CollectionScope = "user" | "agent" | "kb";
export type ObjectType = "user_memory" | "agent_memory" | "kb_entry";
export type IngestionStatus = "queued" | "running" | "completed" | "failed";
export type IngestionStep = "parse" | "vision" | "embed" | "ner" | "autolink" | "index" | "decay";
export type StepStatus = "pending" | "running" | "completed" | "skipped" | "failed";
export type ProposalType = "add_user_memory" | "edit_user_memory" | "delete_item" | "add_document" | "create_connection";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type PermissionLevel = "none" | "read" | "write";

export interface CollectionResponse {
  id: string;
  name: string;
  description: string | null;
  scope: CollectionScope;
  owner_id: string;
  agent_id: string | null;
  parent_collection_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionTreeNode extends CollectionResponse {
  children: CollectionTreeNode[];
  object_count: number;
}

export interface AttachmentResponse {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  parsed_content: string | null;
  blob_path: string;
  created_at: string;
}

export interface EntityRef {
  id: string;
  name: string;
  type: string;
}

export interface EntityInput {
  name: string;
  type?: string;
}

export interface EntitySuggestion {
  id: string;
  name: string;
  type: string;
  usage: number;
}

export interface ObjectResponse {
  id: string;
  object_type: ObjectType;
  subject: string;
  content: string;
  collection_id: string | null;
  collection_name: string | null;
  contributor_id: string;
  approved_at: string | null;
  status: IngestionStatus;
  metadata: Record<string, unknown>;
  importance: number;
  is_pinned: boolean;
  language: string;
  tags: string[];
  entities: EntityRef[];
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  chunk_count: number;
  attachments: AttachmentResponse[];
}

export interface ObjectListResponse {
  items: ObjectResponse[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ProposalResponse {
  id: string;
  proposal_type: ProposalType;
  status: ProposalStatus;
  proposer_id: string;
  collection_id: string | null;
  target_object_id: string | null;
  target_subject?: string | null;
  title?: string | null;
  proposed_data: Record<string, unknown>;
  reviewer_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface IngestionEventResponse {
  id: string;
  step: IngestionStep;
  status: StepStatus;
  detail: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IngestionTaskResponse {
  task_id: string;
  object_id: string | null;
  mode_level: number;
  status: IngestionStatus;
  current_step: IngestionStep | null;
  progress_percentage: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  events: IngestionEventResponse[];
}

export interface AgentResponse {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  revoked: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface AgentTokenResponse {
  agent: AgentResponse;
  token: string;
}

export interface SearchResult {
  id: string;
  object_type: ObjectType;
  subject: string;
  content: string;
  snippet: string | null;
  score: number;
  tags: string[];
  collection_id: string | null;
  collection_name: string | null;
  entities: string[];
  importance?: number;
  created_at: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
}

export type DeploymentMode = "light" | "standard" | "advanced";

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  kind?: "object" | "entity";
}

export type GraphNodeType = "user_memory" | "agent_memory" | "kb_entry" | "collection" | "entity";

export interface GraphNodeData {
  id: string;
  label: string;
  type: GraphNodeType;
  importance?: number;
  entity_type?: string;
}

export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdge[];
  counts: { nodes: number; edges: number };
}

export interface ProviderInfo {
  model: string;
  host: string;
}

export interface HealthResponse {
  status: string;
  version?: string;
  environment?: string;
  mode: DeploymentMode;
  mode_level: number;
  database?: string;
  inference?: {
    embedding: ProviderInfo;
    llm: ProviderInfo;
    ocr: ProviderInfo;
  };
}

export type TaskType = "document" | "memory" | "optimize" | "reindex" | "proactive_link" | "decay";

export interface TaskListItem {
  id: string;
  task_type: TaskType;
  params?: Record<string, unknown>;
  object_id: string | null;
  object_subject: string;
  object_type: ObjectType | null;
  status: IngestionStatus;
  current_step: IngestionStep | null;
  mode_level: number;
  progress_percentage?: number;
  error_message: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListResponse {
  items: TaskListItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface TaskEvent {
  id: string;
  step: IngestionStep;
  status: StepStatus;
  detail: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TaskDetail extends TaskListItem {
  events: TaskEvent[];
}

export interface TaskStats {
  by_status: Record<string, number>;
  total?: number;
  total_edges_created: number;
  graph_edges?: number;
}

export interface IngestAccepted {
  task_id?: string;
  object_id?: string;
  status: string;
  message: string;
}
