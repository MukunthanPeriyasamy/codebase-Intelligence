# Code Standards

## Current direction: complete DeepWiki — 2026-10-14

Use the native Next.js/TypeScript and FastAPI/Python module structure. Retain the upstream MIT license and provenance. Test changes against native routes and the indexing/retrieval/chat pipeline. Windows setup uses an isolated Python runtime and npm lockfile. Python 3.12 is the verified runtime; the old Electron Python 3.14 result is not proof for this dependency stack.

This decision supersedes conflicting historical implementation notes below. See `../README.md` and `../validation/full-deepwiki.md`.

## DeepWiki backend migration — 2026-10-13

Keep DeepWiki source unmodified and pinned; integrate through `tools/deepwiki/pipeline.py` and `src/main/deepwiki.ts`. The stdlib app worker discovers a separately installed tool runtime. Retain host-side redaction, paid-request accounting, cancellation and schema/citation validation. Test real upstream components with synthetic model responses, plus new-commit/delete/profile isolation and source-line coverage.

This supersedes older backend-selection notes below. Details: `../validation/deepwiki-pipeline.md`.

## Code-vector RAG and separate RepoWise tool (2026-10-12)

The current implementation keeps RepoWise 0.55.0 behind a separately installed local MCP adapter for parsing and graph evidence. Setup is per computer, outside the application runtime. This supersedes the older pending-deployment-choice notes below. It is our adapter, not the complete upstream MCP/chat server.

Code embeddings now run through Ollama or OpenRouter and are stored in LanceDB. Settings > Code search builds/resumes/cancels the index after saving an embedding model. Chat merges semantic matches, lexical retrieval and graph expansion, then supplies verified source excerpts and bounded relationships. Provider/model/commit identities are isolated; unchanged embeddings are reused and deleted files are absent from newer snapshot searches. Completed local indexing opts the repository into indexing future commits; remote indexing stays manual and shares the daily request budget. Documentation generation remains paused. Embedding selection alone sends no requests.

Upstream RepoWise does implement hybrid retrieval, context hydration and answer synthesis, largely over wiki pages; those full pipelines have not been imported into the app. Existing graph links remain unresolved name matches, and vector retrieval does not guarantee answer correctness. Live model-quality evaluation is still pending. Architecture, setup, limits and audit: `../validation/code-vector-rag.md`.

## Current providers — Ollama and OpenRouter (2026-10-10)

Verify both provider routes and encrypted-key lifecycle with fixtures, including key isolation from Ollama, nullable cost, truncation diagnostics, shared budget preservation, profile persistence and provider-separated job/cache identities. No paid calls in automated tests. Retain explicit source/schema validation on both providers. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

Verify Ollama capability discovery, local-only routing, no credentials/redirects, saved token limits, schema/citation validation, cancellation, unavailable-server errors and legacy settings migration with fixture transports. Never download models or claim real-model quality during fixture tests. Existing historical cost metadata remains readable; local successful responses have zero provider cost. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

## General

- Keep modules small and single-purpose; separate desktop UI, privileged operations, analysis, retrieval, and publication.
- Fix root causes and preserve evidence/version invariants rather than masking failures.
- Keep third-party analysis behind adapters; validate real capabilities before depending on them.

## TypeScript

- Use strict mode for TypeScript code when the scaffold is established.
- Use explicit types for snapshots, symbols, source spans, jobs, and bridge messages; avoid unchecked `any`.
- Validate unknown IPC input, adapter responses, persisted records, and model output at runtime before trusting them.

## Electron

- Isolate the renderer from Node and privileged APIs; expose only narrowly scoped operations through preload with context isolation.
- Keep Git, filesystem access, credentials, and worker orchestration in host-side code; parsing and generation must not block desktop interaction.
- Render repository text and model output as untrusted content; source citation actions resolve against validated snapshots and paths.

## Styling

- Centralize colors, fonts, and radii in the tokens described in `ui-context.md`; Phase 6 implements the dark/mint desktop theme.
- Keep indexing, coverage, stale-version, and error states distinguishable through text as well as styling.

## IPC and Service Interfaces

- Validate inputs, repository scope, snapshot IDs, and paths before executing operations.
- Keep handlers focused; submit long-running work to bounded jobs and return identifiable job status.
- Use predictable typed results and errors. Expose actionable failures without credentials or secret-bearing source in logs.

## Data and Storage

- Follow `architecture.md` for SQLite metadata, immutable snapshots/artifacts, and versioned caches; keep upstream persistence details behind the adapter.
- Validate record schemas, references, source spans, and hashes before publication. Preserve model/prompt/analyzer versions and uncertainty.
- Make incremental jobs resumable and safe to retry. Verify rename/deletion handling, dependent invalidation, and atomic publication with meaningful tests.
- Test that uncommitted changes are excluded and that citations/cache hits match the requested snapshot. Never use TTL as the sole freshness check.

## File Organization

- `context/` — project requirements, architectural boundaries, conventions, UI decisions, workflow, and progress.
- `validation/` — reproducible backend probes, pinned probe dependencies, observed results, and limitations; not production app code.
- `.research/` — ignored upstream source, isolated validation runtime/cache, and synthetic test repositories; do not modify upstream internals or ship this directory.
- `codebase_intelligence_architecture.png` at the project root — supplied workflow reference.
- `src/main/` — Electron lifecycle, validated IPC, private worker control and encrypted credentials.
- `src/preload/` — narrow context-isolated bridge; never expose generic IPC.
- `src/renderer/` — React components and centralized CSS tokens.
- `src/shared/` — strict TypeScript and runtime-validated Zod contracts.
- `worker/` — Python health service and checkpointed committed-source snapshot/RepoWise adapter; read-only evidence extraction also verifies immutable source for host-side model analysis.
- `scripts/`, `tests/` — build tooling, Node service/boundary tests and Playwright Electron checks.
- `dist/`, `.local/`, `test-results/`, `node_modules/` — ignored build, test/runtime and dependency artifacts.

## Documentation generation

- Reserve each paid request durably before sending; distinguish provider-reported cost from unknown-cost attempts. Never retry paid calls automatically after uncertain outcomes.
- Keep model choice configurable and manual generation as the default. Apply schema, quote/span, source-hash and repository/commit checks before publishing or resolving citations.
- Test provider contracts with injected fixtures without exposing a production test bypass. Report live-model quality separately from transport and reference-integrity checks.

## Retrieval and chat

- Pin each query to a complete snapshot; test queries spanning publication and old-source citations. Include effective conversation input and publication/model/policy versions in exact cache keys, and reverify cached evidence against source.
- Keep direct answers restricted to unambiguous structural lookups. Label unresolved relationships and evidence gaps; absence under bounded search is not proof of absence.
- Interactive chat owns a shared-budget reservation and preempts documentation. Enforce one expansion, request/input/output limits and cancellation in code, with fixture-provider tests separate from real semantic-quality evaluation.

## Integrated UI state

- Preserve ordinary drafts and selections across view navigation, reset repository-scoped state when its scope changes, and clear unsaved credential input when leaving Settings.
- Keep source inspection commit-bound and ignore late citation responses after navigation. Dialogs support Escape and restore focus to their initiating controls.
- Verify repository-to-documentation-to-chat interaction in actual Electron, including the production background-sync timer, shared request accounting and old citations. Wait for asynchronous UI readiness explicitly in tests.

## Model catalogs and embedding versions

Fetch model catalogs only in the host from fixed endpoints with size/time limits and validated responses. Do not expose keys or enable paid calls by listing/saving models. Preserve older settings when adding embedding configuration. Future vector publication must test unchanged reuse, changed/deleted chunks, model migrations and interrupted staging; similarity alone is not calibrated answer confidence.

## Graph dashboard and chat layout checks

Graph checkpoints are read-only visual previews; only complete published snapshots may serve chat evidence. Bound graph payloads and disclose omissions. Test incomplete/wrong-commit rejection for published reads, endpoint integrity, publication refresh, renamed/deleted symbols and no arbitrary renderer paths. Chat layout tests cover fixed composer visibility, Enter/Shift+Enter, narrow widths and retained source citations.

## Workspace exports

Use native host-side folder selection and canonical paths; do not accept arbitrary paths through IPC. Create unique project and version directories, reject linked output subdirectories and publish the Markdown entry point last. Source copies and generated docs must never overwrite existing source versions or personal notes. Keep clone staging on its destination volume, enable Git long paths on Windows, and preserve compatibility with repository settings lacking workspace fields.

Confidence labels must distinguish heuristic evidence support from calibrated accuracy. Derive source badges from retained evidence provenance rather than candidate counts or route names; preserve metadata on exact-cache reuse and version caches when the policy changes.


The 2026-10-11 redesign in `redesign.css` supplies current light/slate/blue tokens; earlier dark/mint rules are historical. Preserve labeled icon navigation, visible focus, readable contrast, narrow-window behavior and stable component drafts when changing styles. Keep technical answer metadata collapsed by default, while evidence and confidence remain visible.
