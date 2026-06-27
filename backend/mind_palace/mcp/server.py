"""
Mind Palace MCP Server
Exposes 22 core tools + 4 kb_writer tools over Streamable HTTP, served by the
main app at /mcp/. Authenticate with an agent bearer token.
"""
import uuid
import os
import contextvars
from typing import Optional, Any

import httpx

# MCP server base URL — defaults to same host
MP_BASE_URL = os.environ.get("MIND_PALACE_URL", "http://localhost:8000")
MP_TOKEN = os.environ.get("MIND_PALACE_TOKEN", "")
MP_AGENT_ID = os.environ.get("MIND_PALACE_AGENT_ID", "")

# Per-request bearer token (set by the HTTP transport from the inbound
# Authorization header); falls back to the MP_TOKEN env if provided.
_request_token: contextvars.ContextVar[str] = contextvars.ContextVar("mp_request_token", default="")


def set_request_token(token: str) -> None:
    _request_token.set(token or "")


def _headers() -> dict:
    h = {}
    token = _request_token.get() or MP_TOKEN
    if token:
        h["Authorization"] = f"Bearer {token}"
    if MP_AGENT_ID:
        h["X-Agent-Id"] = MP_AGENT_ID
    return h


async def _get(path: str, params: dict | None = None) -> Any:
    async with httpx.AsyncClient(base_url=MP_BASE_URL, headers=_headers(), timeout=30.0) as c:
        resp = await c.get(path, params=params)
        resp.raise_for_status()
        return resp.json()


async def _post(path: str, data: dict | None = None) -> Any:
    async with httpx.AsyncClient(base_url=MP_BASE_URL, headers=_headers(), timeout=30.0) as c:
        resp = await c.post(path, json=data or {})
        resp.raise_for_status()
        return resp.json()


async def _put(path: str, data: dict) -> Any:
    async with httpx.AsyncClient(base_url=MP_BASE_URL, headers=_headers(), timeout=30.0) as c:
        resp = await c.put(path, json=data)
        resp.raise_for_status()
        return resp.json()


async def _delete(path: str, params: dict | None = None) -> Any:
    async with httpx.AsyncClient(base_url=MP_BASE_URL, headers=_headers(), timeout=30.0) as c:
        resp = await c.delete(path, params=params)
        resp.raise_for_status()
        return resp.json()


try:
    from mcp.server import Server
    from mcp import types

    server = Server("mind-palace")

    @server.list_tools()
    async def list_tools():
        return [
            # ── Memory Operations ─────────────────────────────────────────────
            types.Tool(
                name="search_memories",
                description="Search memories using hybrid FTS + vector search",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "default": 10},
                        "collection_ids": {"type": "array", "items": {"type": "string"}},
                        "object_types": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["query"],
                },
            ),
            types.Tool(
                name="get_memory",
                description="Retrieve a single memory by ID",
                inputSchema={"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
            ),
            types.Tool(
                name="list_memories",
                description="List memories in a collection",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "collection_id": {"type": "string"},
                        "limit": {"type": "integer", "default": 20},
                        "page": {"type": "integer", "default": 1},
                    },
                },
            ),
            types.Tool(
                name="store_memory",
                description="Store a new agent private memory",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "content": {"type": "string"},
                        "collection_id": {"type": "string"},
                        "importance": {"type": "integer", "default": 1},
                        "entities": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["subject", "content", "collection_id"],
                },
            ),
            types.Tool(
                name="update_memory",
                description="Update an existing memory",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "memory_id": {"type": "string"},
                        "content": {"type": "string"},
                        "subject": {"type": "string"},
                        "importance": {"type": "integer"},
                    },
                    "required": ["memory_id"],
                },
            ),
            types.Tool(
                name="archive_memory",
                description="Archive a memory (soft hide from search)",
                inputSchema={"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
            ),
            types.Tool(
                name="delete_memory",
                description="Permanently delete a memory",
                inputSchema={"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
            ),

            # ── Attachments ───────────────────────────────────────────────────
            types.Tool(
                name="list_attachments",
                description="List a memory/document's attachments (images kept as-is in light/standard mode). Returns id, filename, mime_type, size, and any parsed_content.",
                inputSchema={"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
            ),
            types.Tool(
                name="get_attachment",
                description="Pull an attachment's raw bytes as base64 so you can reconstruct & parse it yourself (e.g. OCR an image the server didn't process in light/standard mode).",
                inputSchema={"type": "object", "properties": {"attachment_id": {"type": "string"}}, "required": ["attachment_id"]},
            ),

            # ── Graph Operations ──────────────────────────────────────────────
            types.Tool(
                name="get_neighbors",
                description="Get graph neighbors of a memory or document",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "node_id": {"type": "string"},
                        "relationship_types": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["node_id"],
                },
            ),
            types.Tool(
                name="create_connection",
                description="Create a semantic graph edge between two objects",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "string"},
                        "target_id": {"type": "string"},
                        "relationship_type": {"type": "string", "enum": ["PART_OF", "THREAD", "RELATES_TO", "REFERENCES", "MENTIONS"]},
                    },
                    "required": ["source_id", "target_id", "relationship_type"],
                },
            ),
            types.Tool(
                name="delete_connection",
                description="Remove a graph edge",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "string"},
                        "target_id": {"type": "string"},
                        "relationship_type": {"type": "string"},
                    },
                    "required": ["source_id", "target_id", "relationship_type"],
                },
            ),

            # ── Collection Operations ─────────────────────────────────────────
            types.Tool(
                name="create_collection",
                description="Create a new collection (agents create agent-scoped only)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "scope": {"type": "string", "enum": ["user", "agent", "kb"], "default": "agent"},
                        "parent_collection_id": {"type": "string"},
                    },
                    "required": ["name"],
                },
            ),
            types.Tool(
                name="list_collections",
                description="List collections visible to the caller",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "scope": {"type": "string", "enum": ["user", "agent", "kb"]},
                        "flat": {"type": "boolean", "default": True},
                    },
                },
            ),
            types.Tool(
                name="update_collection",
                description="Update a collection's name or description",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "collection_id": {"type": "string"},
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["collection_id"],
                },
            ),
            types.Tool(
                name="delete_collection",
                description="Delete a collection",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "collection_id": {"type": "string"},
                        "cascade": {"type": "boolean", "default": False},
                    },
                    "required": ["collection_id"],
                },
            ),

            # ── Proposal Operations ───────────────────────────────────────────
            types.Tool(
                name="propose_user_memory",
                description="Propose adding a memory to User Shared Memory (requires human approval)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "content": {"type": "string"},
                        "collection_id": {"type": "string"},
                    },
                    "required": ["subject", "content", "collection_id"],
                },
            ),
            types.Tool(
                name="propose_user_memory_edit",
                description="Propose editing an existing User Shared Memory (requires human approval)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "memory_id": {"type": "string"},
                        "proposed_content": {"type": "string"},
                    },
                    "required": ["memory_id", "proposed_content"],
                },
            ),
            types.Tool(
                name="propose_deletion",
                description="Propose deleting a User Shared Memory or KB document",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "target_id": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["target_id"],
                },
            ),
            types.Tool(
                name="propose_document",
                description="Propose adding a document to the Knowledge Base",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "content": {"type": "string"},
                        "collection_id": {"type": "string"},
                    },
                    "required": ["subject", "content", "collection_id"],
                },
            ),
            types.Tool(
                name="propose_user_connection",
                description="Propose a graph connection involving User Shared Memory or KB",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "string"},
                        "target_id": {"type": "string"},
                        "relationship_type": {"type": "string"},
                    },
                    "required": ["source_id", "target_id", "relationship_type"],
                },
            ),
            types.Tool(
                name="withdraw_proposal",
                description="Cancel an active proposal",
                inputSchema={"type": "object", "properties": {"proposal_id": {"type": "string"}}, "required": ["proposal_id"]},
            ),

            # ── KB Writer (requires kb_writer capability) ─────────────────────
            types.Tool(
                name="publish_document",
                description="[kb_writer] Publish a document directly to the KB without approval",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "content": {"type": "string"},
                        "collection_id": {"type": "string"},
                        "importance": {"type": "integer", "default": 1},
                        "entities": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["subject", "content", "collection_id"],
                },
            ),
            types.Tool(
                name="update_document",
                description="[kb_writer] Update a published KB document",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string"},
                        "content": {"type": "string"},
                        "subject": {"type": "string"},
                    },
                    "required": ["document_id"],
                },
            ),
            types.Tool(
                name="delete_document",
                description="[kb_writer] Delete a KB document",
                inputSchema={"type": "object", "properties": {"document_id": {"type": "string"}}, "required": ["document_id"]},
            ),
            types.Tool(
                name="get_publish_status",
                description="[kb_writer] Check ingestion task status",
                inputSchema={"type": "object", "properties": {"task_id": {"type": "string"}}, "required": ["task_id"]},
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        try:
            result = await _dispatch(name, arguments)
            import json
            return [types.TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
        except httpx.HTTPStatusError as e:
            return [types.TextContent(type="text", text=f"Error {e.response.status_code}: {e.response.text}")]
        except Exception as e:
            return [types.TextContent(type="text", text=f"Error: {e}")]


    async def _dispatch(name: str, args: dict) -> Any:
        match name:
            # Memory
            case "search_memories":
                params = {"q": args["query"], "limit": args.get("limit", 10)}
                if args.get("collection_ids"):
                    params["collection_ids"] = ",".join(args["collection_ids"])
                if args.get("object_types"):
                    params["object_types"] = ",".join(args["object_types"])
                return await _get("/api/v1/search", params)
            case "get_memory":
                return await _get(f"/api/v1/objects/{args['memory_id']}")
            case "list_memories":
                params = {"page": args.get("page", 1), "page_size": args.get("limit", 20)}
                if args.get("collection_id"):
                    params["collection_id"] = args["collection_id"]
                return await _get("/api/v1/objects", params)
            case "store_memory":
                return await _post("/api/v1/objects", {
                    "type": "agent_memory",
                    "subject": args["subject"],
                    "content": args["content"],
                    "collection_id": args["collection_id"],
                    "importance": args.get("importance", 1),
                    "entities": args.get("entities", []),
                })
            case "update_memory":
                return await _put(f"/api/v1/objects/{args['memory_id']}", {
                    k: v for k, v in args.items() if k != "memory_id"
                })
            case "archive_memory":
                return await _put(f"/api/v1/objects/{args['memory_id']}", {"is_pinned": False})
            case "delete_memory":
                return await _delete(f"/api/v1/objects/{args['memory_id']}")

            # Graph
            case "list_attachments":
                obj = await _get(f"/api/v1/objects/{args['memory_id']}")
                return {"attachments": obj.get("attachments", [])} if isinstance(obj, dict) else obj
            case "get_attachment":
                return await _get(f"/api/v1/attachments/{args['attachment_id']}/data")

            case "get_neighbors":
                params = {}
                if args.get("relationship_types"):
                    params["relationship_type"] = args["relationship_types"][0]
                return await _get(f"/api/v1/objects/{args['node_id']}/links", params)
            case "create_connection":
                return await _post(f"/api/v1/objects/{args['source_id']}/links", {
                    "target_id": args["target_id"],
                    "link_type": args["relationship_type"],
                })
            case "delete_connection":
                return await _delete(
                    f"/api/v1/objects/{args['source_id']}/links/{args['target_id']}",
                    {"link_type": args["relationship_type"]},
                )

            # Collections
            case "create_collection":
                return await _post("/api/v1/collections", {
                    "name": args["name"],
                    "description": args.get("description"),
                    "scope": args.get("scope", "agent"),
                    "parent_collection_id": args.get("parent_collection_id"),
                })
            case "list_collections":
                params = {"flat": str(args.get("flat", True)).lower()}
                if args.get("scope"):
                    params["scope"] = args["scope"]
                return await _get("/api/v1/collections", params)
            case "update_collection":
                return await _put(f"/api/v1/collections/{args['collection_id']}", {
                    k: v for k, v in args.items() if k != "collection_id"
                })
            case "delete_collection":
                return await _delete(
                    f"/api/v1/collections/{args['collection_id']}",
                    {"cascade": str(args.get("cascade", False)).lower()},
                )

            # Proposals
            case "propose_user_memory":
                return await _post("/api/v1/proposals", {
                    "proposal_type": "add_user_memory",
                    "collection_id": args["collection_id"],
                    "data": {"subject": args["subject"], "content": args["content"], "collection_id": args["collection_id"]},
                })
            case "propose_user_memory_edit":
                return await _post("/api/v1/proposals", {
                    "proposal_type": "edit_user_memory",
                    "target_object_id": args["memory_id"],
                    "data": {"memory_id": args["memory_id"], "proposed_content": args["proposed_content"]},
                })
            case "propose_deletion":
                return await _post("/api/v1/proposals", {
                    "proposal_type": "delete_item",
                    "target_object_id": args["target_id"],
                    "data": {"target_id": args["target_id"], "reason": args.get("reason", "")},
                })
            case "propose_document":
                return await _post("/api/v1/proposals", {
                    "proposal_type": "add_document",
                    "collection_id": args["collection_id"],
                    "data": {"subject": args["subject"], "content": args["content"], "collection_id": args["collection_id"]},
                })
            case "propose_user_connection":
                return await _post("/api/v1/proposals", {
                    "proposal_type": "create_connection",
                    "data": {
                        "source_id": args["source_id"],
                        "target_id": args["target_id"],
                        "relationship_type": args["relationship_type"],
                    },
                })
            case "withdraw_proposal":
                return await _delete(f"/api/v1/proposals/{args['proposal_id']}")

            # KB Writer
            case "publish_document":
                return await _post("/api/v1/objects", {
                    "type": "kb_entry",
                    "subject": args["subject"],
                    "content": args["content"],
                    "collection_id": args["collection_id"],
                    "importance": args.get("importance", 1),
                    "entities": args.get("entities", []),
                })
            case "update_document":
                return await _put(f"/api/v1/objects/{args['document_id']}", {
                    k: v for k, v in args.items() if k != "document_id"
                })
            case "delete_document":
                return await _delete(f"/api/v1/objects/{args['document_id']}")
            case "get_publish_status":
                return await _get(f"/api/v1/tasks/{args['task_id']}")

            case _:
                return {"error": f"Unknown tool: {name}"}

except ImportError:
    pass  # mcp package not available — MCP server disabled
