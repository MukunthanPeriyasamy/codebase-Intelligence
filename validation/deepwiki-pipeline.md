# DeepWiki backend migration — 2026-10-13

## Scope and provenance

Production Electron wiring now selects `src/main/deepwiki.ts` and a separate Python
runtime. Upstream is AsyncFuncAI/deepwiki-open, MIT, pinned to
`d92819a9c9f3b99416e3580ff235fc9d3adf8b89` in `tools/deepwiki/pin.json`.
The upstream checkout is not edited. Its license is retained in
`tools/deepwiki/UPSTREAM-LICENSE` and the installed tool.

This is an **adapted DeepWiki pipeline**, not its unmodified HTTP server or complete
`research_chat` implementation. The following boundaries are intentional:

| Stage | Production owner |
| --- | --- |
| Clone/fetch/new commits | Existing Git mirror and immutable snapshot services; never read dirty worktree content into RAG |
| Code chunking | DeepWiki `LineTrackingTextSplitter`, 180 words / 40-word overlap; chunks subdivided into at most 40 source lines for existing citation bounds |
| Embedding | Existing host Ollama/OpenRouter transports, selected model, secret redaction, cancellation and shared remote budget |
| Persistence | LanceDB in the separate DeepWiki runtime, content cache plus commit/profile-specific tables; replaces upstream FAISS/pickle storage |
| Retrieval | DeepWiki `RAG.call` and document hydration with a LanceDB retriever adapter; host combines semantic candidates with RepoWise lexical/graph evidence |
| Context | DeepWiki `prompt_builder` with verified source metadata, relationships, question and bounded conversation history |
| Generation | Existing host provider transports, consuming the DeepWiki-built context; bounded JSON output and citation validation preserve the Electron answer contract |
| Graph | Existing separately installed RepoWise MCP parser/graph adapter retained, including unresolved name-match labels |

The old fixed-window vector profile remains on disk but is not reused. A first
manual build is required for the new profile. Subsequent local commit updates reuse
unchanged embeddings. OpenRouter builds remain manual. Documentation stays paused.
Exact unique definition-location queries still work without a model/index; general
questions require a ready DeepWiki index and do not silently fall back to the old
lexical-only answer pipeline.

## Per-computer setup

From the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-deepwiki.ps1 -ToolDirectory "D:\CodebaseIntelligenceTools\DeepWiki"
```

Requires Git and uv. Setup creates a separate Python 3.12 runtime, installs the
frozen dependencies, downloads the tokenizer cache, checks the pinned clean source,
imports the actual upstream components, and only then registers the runtime in
`%LOCALAPPDATA%\CodebaseIntelligence\deepwiki-tool.json`.
System Python and the app worker's supported versions are unchanged. RepoWise setup
is still required for snapshots/KG. Do not install these packages into the app worker.

This computer's verified development installation is at
`D:\office-project\codebase-intelligence\.local\deepwiki-tool`.
The host-only `CODEBASE_INTELLIGENCE_DEEPWIKI_HOME` override supports isolated tests.
No arbitrary endpoint/path is exposed to the renderer. The bridge uses private
bounded JSON lines, hides child windows and terminates owned processes on cancellation.

After setup: restart the app, save an embedding model, and use Settings → Code search
→ Build / resume code index. Existing repository connections and publications remain.

## Verification

Verified: build/typecheck, all 52 service tests, and both Electron DeepWiki and graph regressions passed. Setup/health and per-computer registration succeeded. Live Ollama was unavailable, so no real-model inference was run. The new
service fixture exercises actual DeepWiki imports/chunking/context construction and
actual LanceDB with deterministic synthetic embeddings/model responses. It covers
restart/resume, profile migration, deleted source, old-commit searches, model change,
cancellation, secret exclusion, cache reuse, Unicode and overlapping chunk coverage.
The Electron fixture covers committed ingestion, dirty-source exclusion, code indexing,
chat, source citations and the existing graph UI. These fixtures do not establish
live model answer quality.

## Limits

- Existing 2,000-unit indexing and six-excerpt answer bounds remain; omissions are
  reported. This does not claim complete analysis of every repository/language.
- RepoWise graph enrichment is bounded and name-resolved, not a proven runtime graph.
- Answer confidence remains an evidence heuristic, not a calibrated probability.
- DeepWiki's optional wiki generation, research loop, public web server, FAISS and
  pickle cache are not enabled. Its dependencies include FAISS because the upstream
  module imports it, but application vectors are stored in LanceDB.
- Upstream still imports a deprecated Google client package. Our provider routing
  uses Ollama/OpenRouter; no Google provider calls occur.
- Live model quality/performance and distributable packaging remain unverified.
