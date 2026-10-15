# Codebase Intelligence

## Approved chat editing and persistent history — 2026-10-15

Chat now supports user-approved code modifications through Edit code mode, alongside answers/research/codemaps. Retrieval grounds proposals in current source. Only explicit Accept writes files; Reject leaves them unchanged. Local folders are edited directly and remote repositories use their local DeepWiki clone, with no commits or pushes. Browser-local, repository-scoped conversation history persists turns and drafts. This explicitly supersedes the historical read-only scope for accepted proposals.


## Current direction: complete DeepWiki — 2026-10-14

The user approved replacing the old Electron application with full DeepWiki and explicitly retaining Ollama. Ollama is the default for generation and embeddings. The native wiki and chat UI is now the product baseline. Existing Electron data remains on disk and is not migrated automatically. Future modifications belong in the full DeepWiki source.

This decision supersedes conflicting historical implementation notes below. See `../README.md` and `../validation/full-deepwiki.md`.

## DeepWiki backend migration — 2026-10-13

The user approved replacing the backend with the recommended DeepWiki-based pipeline, preserving the Electron interface. The adapted pipeline keeps LanceDB, RepoWise KG, Ollama/OpenRouter configuration and committed-only ingestion. Documentation remains paused. General chat requires the new code index; a first manual rebuild is necessary.

This supersedes older backend-selection notes below. Details: `../validation/deepwiki-pipeline.md`.

## Code-vector RAG and separate RepoWise tool (2026-10-12)

The current implementation keeps RepoWise 0.55.0 behind a separately installed local MCP adapter for parsing and graph evidence. Setup is per computer, outside the application runtime. This supersedes the older pending-deployment-choice notes below. It is our adapter, not the complete upstream MCP/chat server.

Code embeddings now run through Ollama or OpenRouter and are stored in LanceDB. Settings > Code search builds/resumes/cancels the index after saving an embedding model. Chat merges semantic matches, lexical retrieval and graph expansion, then supplies verified source excerpts and bounded relationships. Provider/model/commit identities are isolated; unchanged embeddings are reused and deleted files are absent from newer snapshot searches. Completed local indexing opts the repository into indexing future commits; remote indexing stays manual and shares the daily request budget. Documentation generation remains paused. Embedding selection alone sends no requests.

Upstream RepoWise does implement hybrid retrieval, context hydration and answer synthesis, largely over wiki pages; those full pipelines have not been imported into the app. Existing graph links remain unresolved name matches, and vector retrieval does not guarantee answer correctness. Live model-quality evaluation is still pending. Architecture, setup, limits and audit: `../validation/code-vector-rag.md`.

## Current direction — code/KG chat and external RepoWise MCP (2026-10-11)

User paused documentation generation and requested RepoWise as an external MCP tool rather than an application dependency. Production host now blocks manual/automatic document generation, preserves existing documents and excludes documentation from chat retrieval. Chat continues using committed source and existing graph evidence. Build and targeted pause/retrieval tests passed. RepoWise MCP availability is verified, but migration is NOT implemented: server location (separate local tool or remote server), index lifecycle and commit-bound evidence validation must be resolved before replacing the current adapter. Existing Python/RepoWise analysis remains in place until a tested replacement is ready. Do not describe MCP as active or remove the working index prematurely. This supersedes earlier active-generation scope.

## Current providers — Ollama and OpenRouter (2026-10-10)

Both Ollama and OpenRouter are selectable providers for documentation/chat and embedding-model configuration. The default remains Ollama; the user saves the active provider explicitly. Embedding execution/vector indexing remains pending. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

The model provider is now local Ollama, replacing OpenRouter for documentation and chat. No API key or remote model service is used. Installed local embedding models can be selected, but vector indexing remains pending. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

## Overview

An internal Electron desktop application for one developer to understand a repository through evidence-backed technical documentation and read-only cited chat. Source analysis is refreshed in the background when new commits appear. Documentation generation is manual initially, using a model chosen in the app; automatic generation is a separate opt-in. OpenRouter models assist behavioural analysis and answers; targeted retrieval and validated caches reduce repeated model work.

## Goals

1. Explain functions, modules, and workflows with evidence tied to an immutable Git commit and source lines.
2. Accept repositories across code languages, explicitly reporting analysis coverage and unsupported constructs rather than claiming uniform structural precision.
3. Keep answers current through commit-based incremental updates while measuring answer correctness, citation support, latency, tokens, and cost per correct answer.

## Core User Flow

1. Connect through Repository and configure OpenRouter access, model and limits in Settings.
2. Capture a committed snapshot, inventory files, and run structural and behavioural analysis with visible progress and gaps.
3. Save a model ID and request/token limits, generate documentation manually, then browse generated documentation and inspect its cited source at the indexed commit.
4. Open Chat or prefill it from a documentation page, then submit questions; retrieve bounded evidence and return cited answers or explicit uncertainty.
5. Continue using the published snapshot while background sync detects new commits, rebuilds affected knowledge, and publishes a consistent replacement.

## Features

### Repository Knowledge and Documentation

- Source snapshots, symbol and relationship analysis, and behavioural records with source references and uncertainty labels.
- Function, module, workflow, architecture, configuration, and deployment documentation assembled from validated evidence.
- File coverage statuses, bounded resumable jobs, and incremental handling of additions, edits, renames, deletions, and affected dependencies.
- Local repository connection or remote cloning, automatic selected-branch checks, and persistent update/failure notifications in a right sidebar opened from the top navigation bar.

### Retrieval and Cited Chat

- Rules-based symbol lookup, lexical source/path search, current-commit documentation source retrieval and bounded unresolved call-site expansion are implemented. Semantic retrieval is now requested using OpenRouter embeddings; implementation is pending.
- Exact-answer caching scoped to repository, snapshot, relevant conversation state, and policy/model versions.
- Direct rendering for unambiguous definition lookups; OpenRouter-assisted explanations with at most one retrieval expansion and two model requests, subject to shared limits.
- Interactive questions pause documentation jobs and use the saved model/daily budget. Up to three earlier same-commit questions provide context; older answers keep their original citations and are marked stale after a commit update.

## Scope

### In Scope

- A single-developer internal Electron application, initially working with one repository at a time.
- Broad language acceptance with capability-dependent structural analysis and explicit coverage gaps; per-language validation remains required.
- Documentation browsing, source citations, read-only chat, and OpenRouter integration.
- Automatic background sync on new commits from the first MVP; uncommitted working-tree changes are excluded.

### Out of Scope

- Code editing, automated patches, or arbitrary execution of the analyzed repository.
- Multi-user collaboration, hosted SaaS, billing, or team administration.
- Indexing uncommitted changes or silently claiming complete call graphs or proven dynamic behaviour.
- Initial semantic answer caching, learned routing with Laya/Jev, or integration of multiple competing analysis stacks. These are deferred pending measurements.

## Success Criteria

1. A developer can analyze a committed repository, browse documentation, and ask questions with citations resolving to the queried snapshot.
2. Every inventoried file has an explicit status: parsed, document-only, excluded, unsupported, or failed; unsupported behaviour and evidence gaps remain visible.
3. Background sync processes new commits, correctly handles changed and affected records including renames/deletions, and never indexes uncommitted edits.
4. Queries use a consistent published snapshot; stale answers cannot be reused across incompatible versions, and interrupted jobs can resume with failures visible.
5. A developer-verified evaluation set initially covering at least 50 representative questions measures correctness, evidence recall, citation support, uncertainty, latency, resource use, and cost. Numerical targets follow the baseline.

## Integrated Desktop Workflow

Phase 6 provides Repository, Documentation, Chat and Settings views with persistent repository/commit/job status and the top-nav notification sidebar. Both documentation and chat open the same read-only captured-source dialog. Navigation preserves ordinary drafts and selections; background updates retain old citations at their original commit. Evaluation and distributable packaging remain Phase 7.

## Confirmed extension

The user selected OpenRouter embeddings and requested vector-first retrieval, followed by KG and source only when evidence is insufficient. Searchable model catalogs and separate embedding selection are implemented. Workspace selection, Markdown export and live KG visualization are implemented. Local vector storage, incremental embedding updates and sequential retrieval remain implementation work.

The requested full-section chatbot interface and React Flow KG dashboard are implemented. The graph displays indexed structural records and live build checkpoints with explicit unresolved-call labels. This visualization does not change retrieval routing or establish a complete runtime knowledge graph.

Workspace folder selection and readable Markdown export are now implemented. The selected folder holds a per-repository private clone, browsable committed source versions, generated Markdown versions and personal notes. Internal evidence indexes, caches, ledgers and credentials remain in application data. OpenRouter vector storage/re-embedding and sequential retrieval are still pending.
