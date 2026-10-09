# Code Standards

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
