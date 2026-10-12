# Code-vector RAG and RepoWise audit

Date: 2026-10-12. Upstream inspected: RepoWise 0.55.0, commit
`7f84ae07908de40595fc64b3fe3c910123367a1e`. Upstream source was not modified.

## What RepoWise already implements

1. Hybrid retrieval: `_answer_pipeline.py::hybrid_retrieve` runs full-text,
   vector and symbol retrieval and combines ranks using reciprocal rank fusion.
   `expand_via_graph` expands neighboring files through projected graph edges.
2. Context construction: `tool_answer/hydration.py` and `source.py` hydrate
   symbol signatures and source excerpts, check bounds, and enforce budgets.
3. Answer synthesis: `tool_answer/answer.py` coordinates retrieval, graph
   expansion, hydration, confidence/degraded paths, and `synthesis.py` provider calls.
   Its web chat separately alternates model/tool turns with conversation context.

These are real implementations in the pinned upstream, not features automatically
inherited by importing its parser. `get_answer` is largely wiki-page oriented;
its graph expansion expects neighboring pages. It is more complete than our old
adapter, but no live-model comparison establishes better answer quality for this
repository. No claim of hallucination elimination is made.

Upstream references:
- [Hybrid retrieval and expansion](https://github.com/repowise-dev/repowise/blob/7f84ae07908de40595fc64b3fe3c910123367a1e/packages/server/src/repowise/server/mcp_server/_answer_pipeline.py)
- [Answer pipeline](https://github.com/repowise-dev/repowise/blob/7f84ae07908de40595fc64b3fe3c910123367a1e/packages/server/src/repowise/server/mcp_server/tool_answer/answer.py)
- [Source hydration](https://github.com/repowise-dev/repowise/blob/7f84ae07908de40595fc64b3fe3c910123367a1e/packages/server/src/repowise/server/mcp_server/tool_answer/hydration.py)

## Application implementation

The separate RepoWise-backed MCP adapter remains responsible for structural
extraction and graph retrieval. It is our adapter, not the full upstream MCP
server or web chat. Document generation remains paused.

`VectorService` indexes non-redacted committed source in chunks of up to 40
lines. Source is hash-checked and secret-filtered before embedding. Ollama uses
`/api/embed` with truncation disabled. OpenRouter uses `/embeddings`; remote
embedding requests share the persisted daily request budget and credentials
stay in the Electron host. Local embeddings do not consume the paid-request ledger.

LanceDB runs in the separately installed tool runtime, through a bounded local
worker. The worker is reused during batches, has a 60-second operation deadline,
and is stopped on cancellation/shutdown or after idle time. Setup installs the
pinned LanceDB dependencies; the app's Python worker stays stdlib-only.

Storage: `<knowledge>/repositories/<repo-id>/vectors/lancedb`. A provider/model/
chunker-specific cache reuses identical embedding inputs. Each snapshot/profile
gets its own searchable table. Only a completed manifest enables semantic search.
Resume reuses cached vectors. New commits contain only their current files;
deleted/renamed old paths remain available only in old snapshot tables. Old
tables are retained with historical snapshots, not automatically garbage-collected.

After the first successful local index, new commits update automatically, including
after restart. OpenRouter indexing remains manual. Changing embedding model or
provider requires a new index. Use versioned model names: replacing weights behind
the same model tag is not automatically detected. Dimension mismatches are rejected.

Chat embeds the question, retrieves cosine-nearest code chunks from the exact
snapshot/model table, seeds existing RepoWise call-graph retrieval from up to two
candidate symbols, and merges semantic, lexical and graph ranks. It passes verified
source excerpts and relationship records to the selected chat model. Cache keys
include vector-profile/readiness state. Missing/failed vector retrieval is reported
as a gap, with lexical/graph fallback. Citations are still validated before display.

## Setup and use

1. Run `scripts/setup-repowise.ps1 -ToolDirectory D:\CodebaseIntelligenceTools\RepoWise`
   on each Windows computer (uv required). A per-user manifest registers the folder.
   Setup checks Python isolation before installing packages. Use another disk if C:
   lacks space; this machine's tool is on D:.
2. Restart the rebuilt app. Check RepoWise setup in Settings.
3. Choose an installed Ollama embedding model, or an OpenRouter embedding model;
   save Models & limits. The chat model is a separate selection.
4. Choose **Code search > Build / resume code index**. Wait for Ready, then chat.
   Stop is safe; resume reuses completed embeddings. Saving settings alone does not
   invoke embedding or generation.

## Bounds and remaining limitations

- Plans use the existing 1,999 source-page cap and report omitted coverage. Oversized,
  excluded and secret-containing chunks are not embedded.
- Search is exact cosine search over LanceDB vectors; no ANN acceleration yet.
- The graph remains bounded and name-matched; imports/dynamic dispatch are not fully
  resolved. This does not claim the full upstream graph/answer pipeline is integrated.
- The model receives at most six source excerpts plus bounded relationships. Code
  suggestions remain text; no edits are applied to the analyzed repository.
- Reference checks establish citation consistency, not semantic correctness. The
  earlier invalid-function-ID error remains a legitimate rejection of unsupported
  model output, not something a vector database alone guarantees to eliminate.
- Live Ollama was unreachable during verification. No paid inference was executed.

API reference consulted: [LanceDB Python](https://lancedb.github.io/lancedb/python/python/).

## Verification completed

- Build and TypeScript validation passed.
- Full 50-test service suite passed after LanceDB integration; the added embedding
  adapter test and expanded vector/RAG integration test passed in a targeted run.
- Real LanceDB tests cover restart persistence, resume without re-embedding,
  incremental local indexing, deleted-file isolation, old-snapshot search,
  embedding-model isolation, secret exclusion, cancellation, wrong-commit rejection,
  hybrid retrieval, model context construction and validated chat citations.
- Electron graph workflow passed with RepoWise setup, code-index controls,
  committed graph updates, direct cited chat, documentation pause and narrow layout.
- The initial desktop retry corrected a test-label encoding issue. Windows table
  path limits were fixed with short physical names plus full identity metadata.
- Synthetic embeddings/model responses establish wiring and invariants only.
  Live Ollama was unreachable; real-model retrieval/answer quality is unverified.
