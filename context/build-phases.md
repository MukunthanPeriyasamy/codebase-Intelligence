# Build Phases

## Approved chat editing and persistent history — 2026-10-15

New feature unit: retrieval-grounded edit proposals, 50/50 chat/diff review, explicit acceptance/rejection and persistent per-repository chat history. Validate backend write boundaries and browser restore/follow-up behavior. Live model edit quality remains separate from deterministic integration verification.


## Current direction: complete DeepWiki — 2026-10-14

Current milestone: replace the active Electron source with full DeepWiki, retain Ollama, provide Windows setup/start commands, and verify native indexing-to-chat plus frontend startup. Previous phase completions describe the retired implementation and must not be treated as validation of this replacement.

This decision supersedes conflicting historical implementation notes below. See `../README.md` and `../validation/full-deepwiki.md`.

## DeepWiki backend migration — 2026-10-13

Requested backend replacement now targets the adapted DeepWiki pipeline before Phase 7. Verify actual upstream chunking/RAG/context components, LanceDB persistence, commit/profile isolation and Electron chat/citations. Live-provider quality evaluation and packaging remain Phase 7; a new integration fixture does not complete those phases.

This supersedes older backend-selection notes below. Details: `../validation/deepwiki-pipeline.md`.

## Code-vector RAG and separate RepoWise tool (2026-10-12)

The current implementation keeps RepoWise 0.55.0 behind a separately installed local MCP adapter for parsing and graph evidence. Setup is per computer, outside the application runtime. This supersedes the older pending-deployment-choice notes below. It is our adapter, not the complete upstream MCP/chat server.

Code embeddings now run through Ollama or OpenRouter and are stored in LanceDB. Settings > Code search builds/resumes/cancels the index after saving an embedding model. Chat merges semantic matches, lexical retrieval and graph expansion, then supplies verified source excerpts and bounded relationships. Provider/model/commit identities are isolated; unchanged embeddings are reused and deleted files are absent from newer snapshot searches. Completed local indexing opts the repository into indexing future commits; remote indexing stays manual and shares the daily request budget. Documentation generation remains paused. Embedding selection alone sends no requests.

Upstream RepoWise does implement hybrid retrieval, context hydration and answer synthesis, largely over wiki pages; those full pipelines have not been imported into the app. Existing graph links remain unresolved name matches, and vector retrieval does not guarantee answer correctness. Live model-quality evaluation is still pending. Architecture, setup, limits and audit: `../validation/code-vector-rag.md`.

## Current direction — code/KG chat and external RepoWise MCP (2026-10-11)

User paused documentation generation and requested RepoWise as an external MCP tool rather than an application dependency. Production host now blocks manual/automatic document generation, preserves existing documents and excludes documentation from chat retrieval. Chat continues using committed source and existing graph evidence. Build and targeted pause/retrieval tests passed. RepoWise MCP availability is verified, but migration is NOT implemented: server location (separate local tool or remote server), index lifecycle and commit-bound evidence validation must be resolved before replacing the current adapter. Existing Python/RepoWise analysis remains in place until a tested replacement is ready. Do not describe MCP as active or remove the working index prematurely. This supersedes earlier active-generation scope.

## Current providers — Ollama and OpenRouter (2026-10-10)

Dual-provider configuration/routing restores OpenRouter beside Ollama for documentation/chat and model catalogs. This does not complete the pending embedding lifecycle, sequential retrieval or live model-quality evaluation. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

The requested provider replacement is local Ollama for documentation/chat and installed embedding-model selection. This changes the runtime provider, not the phase completion claims. Real local-model quality/performance evaluation and embedding execution remain pending. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

Each phase ends with a working, verified unit. Phases 1-6 are complete; Phase 7 is next. Evidence and limits are in `../validation/README.md`, `../validation/phase2.md`, `../validation/phase3.md`, `../validation/phase4.md`, `../validation/phase5.md` and `../validation/phase6.md`. Later phases are not yet implemented. Incremental updates are part of this MVP, not a later production feature.

| Phase | Work | Exit evidence |
| --- | --- | --- |
| 1. Backend validation and baseline | Pin RepoWise, verify language capabilities and source spans, probe graphs and commit diffs, define the adapter contract, establish representative evaluation fixtures/questions. | Reproducible coverage and retrieval baseline, documented incompatibilities and mitigation, and a justified integration decision. Synthetic smoke tests alone do not finish this phase. |
| 2. Electron foundation | Main/preload/renderer scaffold, typed validated bridge, local service/worker lifecycle, credential boundary, build tooling. | Desktop launch and build pass; privileged operations stay outside the renderer; worker status and failures reach the UI. |
| 3. Snapshots and background sync | Local repository selection/remote clone, immutable committed snapshots, full inventory, new-commit detection, changed/affected records, resumable jobs, atomic publication and requested notification sidebar. | Add/edit/rename/delete commits refresh correctly; dirty worktrees are excluded; published source retains a consistent version during rebuilds; updates are visible under the top-nav notification icon. Selected branch checks run every 60 seconds while the app is open. |
| 4. Behaviour and documentation | OpenRouter analysis, evidence records, schema/span validation, bounded generation, function/module/workflow docs, invalidation and regeneration on new commits. | Browsable documentation is grounded in the active snapshot; claims carry evidence/uncertainty; incomplete work is visible and resumable. |
| 5. Retrieval and cited chat | Rules-based routing, symbol/source/docs/graph retrieval, evidence budgets, OpenRouter answers, direct lookup answers, exact caching, bounded fallback. | Representative questions return supporting citations; insufficient evidence is explicit; cache/version and deletion tests pass. |
| 6. Complete desktop workflow | Integrate repository setup, model settings, progress/coverage, documentation navigation, source viewer, and chat; finalize visual design. | A developer completes the repository-to-documentation-to-chat flow while background sync remains responsive. |
| 7. Evaluation and packaging | Representative held-out evaluation, regression checks, recovery/resource limits, performance and cost measurement, desktop packaging. | Initial 50-question developer-verified evaluation, documented measured limits, working packaged application for the selected OS, and reliable restart/update behavior. |

The seven phases order implementation; they do not add SaaS, code modification, learned routing, or other deferred features. The baseline evaluation begins in Phase 1 and is rerun against the integrated app in Phase 7. The user selects the model in the app; documentation is manual by default with configurable request/token limits. Live model quality evaluation and packaging targets remain tracked in `progress-tracker.md`. Phase 2 selected React/Vite and a provisional dark design; Phase 3 implemented repository/sync defaults and the requested notifications.

Phase 5 uses bounded lexical/source/symbol retrieval and unresolved call-site expansion, plus current-commit documentation source candidates. Semantic embeddings and complete graph resolution are not claimed. The model is shared with documentation; chat consumes the same daily request budget and takes priority over documentation jobs. Exact caching includes the effective bounded conversation context.

Phase 6 implements four persistent navigation views, shared Settings, commit/job status and a captured-source dialog with keyboard focus return. Documentation can prefill Chat without a provider request. The integrated Electron workflow verifies drafts and old citations through the actual 60-second background sync timer. The dark/mint layout is implemented and visually reviewed at normal and narrow desktop widths.


Before Phase 7, implement the user-requested extension: workspace storage and document export, OpenRouter embedding lifecycle, sequential vector/KG/source retrieval, full-section Chat and live React Flow KG. Model catalog selection is the first implemented unit; this does not mark vector indexing complete.

The full-section Chat and live React Flow KG presentation units are complete. Workspace directory selection/document export is also complete. Embedding storage/publication and sequential vector/KG/source retrieval remain pending before Phase 7.

Workspace selection and Markdown export are complete: native picker persistence, destination-local clone staging, versioned browsable source, generation-specific Markdown with a latest index and preservation of prior exports/notes. Vector storage and re-embedding remain separate work.
