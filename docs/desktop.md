# DeepWiki Studio desktop

Run `npm install`, then `npm start`. The launcher starts Electron, starts the existing
FastAPI backend, verifies its Chroma readiness, starts Next.js, and opens the editor
after the frontend responds. A startup failure is displayed in a native dialog and
the terminal. Ports 3000 and 8001 must be free; existing processes are never taken over.

The Python runtime must already be prepared using `scripts/setup-deepwiki.ps1`.
Setup selects Python 3.12 explicitly, using uv to obtain it when needed. If a previous
attempt created a Python 3.14 or incomplete runtime, setup preserves it under
`.local/deepwiki-tool/runtime-backup-*` and creates a supported environment. Close any
running backend before rerunning setup. The requirements lock targets Python 3.12;
do not enable prereleases to work around a Python-version dependency conflict.
Ollama remains an external model service. Start it separately for local model answers.
CodeGraphContext retains its optional isolated setup (`npm run setup:kg`).

## Workspace

The top-right Settings gear opens model configuration and document generation.
Save settings to update the existing chat without clearing its history. Generation
uses the selected workspace, provider/model, Ollama embedding model, language,
coverage and exclusions. Its progress stays connected while the dialog is closed;
the task ID is saved per workspace for reconnecting after reopening the app and folder.
Authorization codes are entered only when required and are not stored. The model
names and generation preferences are stored on this device. Open folder is in the
Explorer toolbar and welcome screen.

- Left: native folder selection, lazy directory tree, visible-file filtering, file
  and folder creation, refresh. Dependency/cache directories are hidden.
- Center: local Monaco editor with syntax highlighting, tabs, line numbers, find,
  undo/redo, dirty indicators, save button and Ctrl/Cmd+S. Columns can be resized.
- Right: existing chat, modes, history, model selection and MCP commands. Local
  repository requests and natural-language KG queries use the selected workspace.
- Code citations open the corresponding file. Edit proposals appear in the center
  canvas with the existing Accept/Reject flow. Accepted changes refresh clean editor
  buffers; dirty buffers stay intact and subsequent saves detect disk conflicts.
- Documentation workspace opens in a separate desktop window using the existing
  wiki interface. It shares the same managed frontend and backend.

Manual saves require matching the hash read from disk; externally changed files
produce a conflict instead of being overwritten. Use Reload to explicitly discard
the buffer and read the new version. Closing a dirty tab, changing folders or closing
the window asks before discarding unsaved work. Files are UTF-8 text up to 2 MB.
Other encodings and binary files are not editable in this version.

The renderer has no Node access. A sandboxed preload exposes only folder selection,
listing, reading, creating and saving within the chosen root. IPC checks the sender
and real paths; traversal and links escaping the root are rejected. Monaco is served
locally rather than downloaded from a CDN. External links open in the default browser.

Closing the main window stops the service process tree it owns, including the KG
child. `npm run start:web` retains browser-only operation. `npm run start:backend`
and `npm run start:frontend` retain their independent service commands.

This is a runnable source-checkout desktop application. It currently uses the Next
development server and the prepared project Python runtime. A signed distributable
installer with bundled Python/models is not included; packaging is a separate step.

## Verification

`node --test tests/electron-workspace.cjs` checks saving, stale-write rejection,
workspace boundaries, binary rejection and file creation. `node tests/electron-smoke.cjs`
uses Playwright from `.local/ui-test/node_modules/playwright` to start real Electron
and services, open a fixture folder, type into Monaco, save and create files, route a
KG question (mock model response), and render the approval panel in the center column.
It writes its screenshot and fixture files under `.local`.

The existing document-first editing rules are unchanged. Switching to Electron does
not fix missing document evidence or model-generated invalid edit proposals.

## Document preview and workspace copies

Settings > Document generation > Preview saved documentation loads the persisted
wiki for the selected directory and language, including after restarting the app.
Select a page to view rendered Markdown, code blocks and diagrams. Save Markdown
to workspace exports every page into a uniquely named `deepwiki-document-*.md`
file in the selected root without overwriting previous copies. Refresh the explorer
to open that file. These files are reference exports; chat continues using the backend
index, not edits made to an exported Markdown copy.

The existing RAG path is generated pages -> overlapping chunks -> Ollama embeddings
-> persistent ChromaDB -> metadata-filtered retrieval -> cited model response.
Repository, generation session, language and embedding model isolate retrieval.
The preview displays the index metadata recorded during generation; it is not a
live Ollama or Chroma health probe. Regenerate documents when the source changes.

## Document and graph context for edits

Edit code retrieves generated documentation first, then uses up to three documented
symbols as anchors for CodeGraphContext MCP caller/callee queries (six queries maximum).
Queries use the selected checkout path and the anchor's exact source path. Up to twelve
related text files are read from the current checkout, subject to the existing path,
size, context-budget and source-snapshot checks. Graph output supplies navigation
hints, never replacement source or instructions. The review panel records graph
relationships and unavailable-index warnings. Missing documents still stop the flow;
an unavailable KG produces an explicit document-only fallback. The repository must
already be indexed in KG; editing does not automatically index or mutate the graph.
Accept/reject remains the only route to applying a proposal. Regenerate documentation
and refresh the graph after source changes. Document generation and normal RAG chat
are unchanged by this integration.

Local generation now automatically writes a unique `deepwiki-document-*.md` in
its workspace root, including when generation reuses cached results. Export failures
are surfaced instead of reporting successful completion. Reference copies are excluded
from subsequent wiki inventories. Existing documents can also be exported manually.
Chat source lists are collapsed by default. Green percentages show clamped cosine
similarity, `(1 - distance) * 100`, not calibrated answer confidence. Sources without
a recorded distance have no score displayed.

## Automatic KG startup and parallel indexing

Generating a wiki starts CodeGraphContext indexing after the checkout is prepared,
in parallel with document analysis/generation. Cached documentation runs also start
the graph stage. The pipeline exposes a separate KG row; failures preserve the document
result. Existing graph indexes are reused and explicitly labeled as not rebuilt.

Without `.local/kg-mcp.json`, the app uses `uvx --python 3.12 --from
codegraphcontext==0.5.1 codegraphcontext mcp start`; the first launch requires network
access to obtain the isolated MCP runtime. Install uv using the normal setup prerequisite.
An explicit MCP configuration still overrides the launch command. The default MCP
user home/database is isolated under `.local/kg-data`. Generation authorizes its
selected checkout for the MCP path sandbox. Graph builds are serialized with each
other, but run concurrently with documentation. Authorizing a newly selected root
restarts the shared MCP server; avoid running independent slash-command indexing jobs
while starting generation for another checkout.

Edit planning now has a Code Map-style locate phase before generating replacements.
The model selects verbatim blocks from document/KG-guided current source; shared snippet
location recovers real line numbers. Editing requires unique complete matches and rejects
hidden lines, guessed paths and first-line-only matches. Located blocks appear in the
review panel. This adds one model call per edit request; Accept/Reject and stale-source
checks still govern all writes.

## Retry handling

Document structure, Ollama embedding requests, edit block selection and edit model
responses retry transient transport errors and HTTP 408/429/500/502/503/504 up to
three total attempts, with 1s then 2s delay. Retries discard partial edit output.
Document pages retain their configured retry budget, now with backoff and progress
details. KG retries connection and read-only job-status requests. An ambiguous
index-submission failure is not resubmitted automatically, avoiding duplicate jobs.
Invalid paths, authorization errors and source validation failures are not treated
as transient. Accept/reject writes are never replayed. Exhausted failures remain
visible through the existing pipeline/review error handlers and retry logs.
