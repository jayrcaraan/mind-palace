# MCP Server

Mind Palace ships an [MCP](https://modelcontextprotocol.io) server so AI assistants
(Claude, etc.) can use your memory as a tool. It proxies the REST API, so everything
respects the same auth, privacy filter and permission levels.

## HTTP transport (recommended)

The MCP server is exposed over **Streamable HTTP** by the same app, at **`/mcp/`** — no
separate process to run. Authenticate with an agent token via the `Authorization`
header. The exact JSON is shown (copy-paste ready) on the **Agents** page when you
create an agent.

```json
{
  "mcpServers": {
    "mind-palace": {
      "url": "https://your-host/mcp/",
      "headers": { "Authorization": "Bearer mp_agt_xxx" }
    }
  }
}
```

Create the token on the **Agents** page (shown once at creation). The endpoint also
answers at `/mcp` (307-redirects to `/mcp/`).

## Tools (26)

### Memory (7)
`search_memories` · `get_memory` · `list_memories` · `store_memory` ·
`update_memory` · `archive_memory` · `delete_memory`

### Attachments (2)
`list_attachments` · `get_attachment` — pull an attachment's raw bytes (base64) so
the agent can reconstruct & parse it itself. In **light/standard** mode the server
keeps images as attachments **without** OCR, so agents are expected to fetch and
parse them on their own.

### Graph (3)
`get_neighbors` · `create_connection` · `delete_connection`

### Collections (4)
`create_collection` · `list_collections` · `update_collection` · `delete_collection`

### Proposals (6) — for agents without write access
`propose_user_memory` · `propose_user_memory_edit` · `propose_deletion` ·
`propose_document` · `propose_user_connection` · `withdraw_proposal`

### Knowledge-base writer (4)
`publish_document` · `update_document` · `delete_document` · `get_publish_status`

## Permission model — capabilities

An agent's access is defined entirely by its **capabilities** (no separate permission
level): `read_memory`, `read_kb`, `link_nodes`, `write_memory`, `write_kb`.

- An agent **with** the matching write capability commits directly (`store_memory`,
  `publish_document`, `create_connection`, …).
- An agent **without** it doesn't get an error — the change is **automatically recorded
  as a proposal** in your **Proposals** queue for approval. (The `propose_*` tools do the
  same thing explicitly.)
- `link_nodes` grants non-destructive edge creation without granting content writes.
- Agents never see other agents' private memory.

This lets you safely connect assistants to your knowledge: they can read freely,
and anything outside their scope becomes a suggestion you approve — nothing lands
unilaterally.
