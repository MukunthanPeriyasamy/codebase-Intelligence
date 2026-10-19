# CodeGraphContext MCP chat — phase one

CodeGraphContext runs as a separate MCP stdio process. FastAPI discovers its tools,
validates arguments against their live JSON schemas and dispatches explicit calls.
The existing chat renders results and persists them through its existing history.
Document generation and code-editing pipelines are unchanged.

## Setup

Run `npm run setup:kg` once (requires uv and network access), then `npm start`.
The setup resolves CodeGraphContext 0.5.1 in an isolated uv environment; it does not
add its parser or database dependencies to the backend Python environment.
Configuration lives in `.local/kg-mcp.json`. Existing configuration is preserved.
The server starts lazily when chat requests the command catalog, and remains alive
for background indexing jobs. Stop the backend to stop its MCP process.

Alternatively copy `config/kg-mcp.example.json` and supply an existing MCP server
executable and workspace. `DEEPWIKI_KG_CONFIG` can select another config file.
The configuration is operator-owned: chat cannot change executables or launch arguments.
This adapter supports stdio, not remote HTTP/SSE MCP servers.

## Testing in chat

1. Type `/` to discover commands. Filter by typing a command name; Down enters the
   list, arrow keys select, Enter opens arguments, Escape closes.
2. Select `/add_code_to_graph`, enter the repository path in its JSON arguments,
   choose Use command, then Ask. Confirm indexing.
3. Run `/check_job_status` with the returned job ID until it completes.
4. Run `/find_code` or `/analyze_code_relationships` with explicit arguments.
5. Select **Knowledge Graph** in the chat mode menu and ask `Who calls my_function?`
   normally. The mode is saved with chat history. `/kg Who calls my_function?` also
   remains available from any mode. Both use the selected chat model. Only read-only
   tools are available to the model. Tool failures and missing index data are evidence,
   not permission to invent an answer. Use explicit slash tools if model planning fails.

The menu exposes all tools advertised by the connected server. Non-allowlisted tools
require explicit confirmation; this includes graph deletion, bundle loading, report
export and arbitrary Cypher. Source edits are not performed by `/kg`.

## Scope and limitations

This is a local developer testing interface, not a multi-tenant deployment. CGC uses
its standard user-local graph storage (KuzuDB in the example); `cwd` identifies the
configured workspace, not an automatically isolated database. Natural-language
queries inject that workspace into tools supporting `repo_path`. Administrative list
tools may list all repositories in the connected graph. Explicit tool arguments and
context switching can access other graphs. The graph workspace is displayed in chat
and does not automatically follow the repository page. Use a dedicated CGC context
when testing different repositories. Do not expose these endpoints publicly.

Read-only queries do not require documents in this explicit KG test interface.
The ordinary document-first chat is unchanged. Integrating document seeds, repository
revision isolation and approval-based editing is a later phase.

Diagnostics: `.local/logs/kg-mcp.log`. On timeout, inspect job status before repeating
an operation; the client never retries tool calls automatically. Restart the backend
after changing configuration. Validate graph relationships on representative source
before relying on them for edits; indexed relationships may be incomplete or stale.
