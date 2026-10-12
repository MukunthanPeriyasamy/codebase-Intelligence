# Progress Tracker

## Current direction — code/KG chat and external RepoWise MCP (2026-10-11)

User paused documentation generation and requested RepoWise as an external MCP tool rather than an application dependency. Production host now blocks manual/automatic document generation, preserves existing documents and excludes documentation from chat retrieval. Chat continues using committed source and existing graph evidence. Build and targeted pause/retrieval tests passed. RepoWise MCP availability is verified, but migration is NOT implemented: server location (separate local tool or remote server), index lifecycle and commit-bound evidence validation must be resolved before replacing the current adapter. Existing Python/RepoWise analysis remains in place until a tested replacement is ready. Do not describe MCP as active or remove the working index prematurely. This supersedes earlier active-generation scope.

## Ollama timeout correction — 2026-10-10

Added a dedicated local HTTP dispatcher to avoid independent five-minute header/body limits, with a cleared 30-minute generation deadline, 60-second metadata deadline, two-minute catalog bound and aligned chat deadline. Cancellation remains available; generation timeout and connection failures have separate diagnostics. Build, 42 service tests, an additional real delayed-HTTP regression and the Electron dual-provider scenario passed. No model inference was run: the local Ollama server was unreachable during the connection probe. Live performance remains to be checked after starting Ollama. OpenRouter remains available.

## Gemini structured-output compatibility — 2026-10-10

Adapted Gemini wire schemas to its documented subset while retaining full local output/citation validation. Replaced misleading HTTP 400 model-support diagnosis with bounded, sanitized error classification. Build and all 40 service tests passed; targeted provider checks also cover nullable chat schemas, unchanged other-provider schemas and no automatic retries. No paid inference or live Gemini success is claimed. The prior rejected response body was discarded, so its precise cause remains unconfirmed. Restart the built app and explicitly resume to verify the live endpoint.

## Current providers — Ollama and OpenRouter (2026-10-10)

Implemented dual Ollama/OpenRouter routing, encrypted remote credentials, provider-specific catalogs and model profiles, explicit active-provider labels, provider-scoped caches/jobs and automatic-generation reset on provider switch. Existing local settings/publications remain readable. Build, all 38 service tests and seven targeted Electron scenarios passed across runs. The dual-provider scenario verifies remote documentation/chat, key encryption, return to Ollama and restart persistence. No paid calls. Report: `../validation/dual-providers.md`. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

Implemented replacement of OpenRouter with local Ollama: native schema-constrained completion, installed-model discovery, local connection testing, removal of API-key controls/bridge, longer bounded inference, saved output-limit visibility and safe settings migration. Preserved historical docs/accounting; paused automatic generation during migration. Verification results will be recorded in validation/ollama.md. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

Update this file after every meaningful implementation change.

## Current Phase

- **Phases 1-6 complete; requested workspace/retrieval extension in progress before Phase 7.** Model catalog configuration is implemented.

## Current Goal

- Complete the requested workspace/retrieval extension in verified units, then proceed to Phase 7 evaluation and packaging.

## Completed

- Reviewed the research and diagram; captured Electron, single-developer internal use, OpenRouter, broad language acceptance and automatic commit-only background sync requirements.
- Populated project context and the seven-phase build sequence.
- Pinned RepoWise 0.55.0 to `7f84ae07908de40595fc64b3fe3c910123367a1e`; installed the complete package in an isolated Python 3.12.14 environment and froze dependencies.
- Passed 24/24 initial synthetic symbol/span/call/Git checks across seven languages.
- Indexed complete pinned itsdangerous 2.2.0 and p-limit 6.2.0 release archives. Inventory records all 73 archive files, hashes and statuses; all persisted symbol spans resolve inside captured source.
- Established 50 source-grounded seed questions and expected facts/anchors. Upstream found the expected file for 40/45 answerable questions; 5/5 absent-symbol queries were empty. A bounded source/path fallback recovered all five file-level misses. These are retrieval results, not generated-answer correctness.
- Checked actual grammar loading and 61 fixture files across 15 tags. Twenty-six grammar tags loaded; COBOL's runtime grammar cache was unavailable. Coverage limits are explicit.
- Passed 21/21 lifecycle checks: persisted cross-file calls/provenance, parse cache, add/edit/rename/delete, dependent invalidation, obsolete-symbol removal, tombstone filtering, commit stamping, old-index preservation and completed-run resume.
- Interrupted real-repository indexing after symbol persistence, then resumed successfully: 158 symbols, 27 pages and 557 edges matched uninterrupted indexing, with no duplicate symbols and SQLite integrity OK.
- Selected Python worker + pinned RepoWise adapter, local SQLite/files, committed snapshots, explicit coverage, source-search fallback and application-owned publication. Contract: `../validation/adapter-contract.md`.
- Saved pins/checksums, scripts, dependency freezes, JSON results, reproduction instructions and limitations in `../validation/README.md`.
- Built Electron main/preload, React/Vite renderer, strict TypeScript/Zod contracts and pinned npm dependencies. Privileged operations remain in the host; bundled assets use an allowlisted custom protocol and restrictive CSP.
- Implemented Python 3.12 startup, health checks, sanitized errors, stop/restart and serialized shutdown transitions, with SQLite metadata schema initialization and incompatible-schema rejection.
- Implemented OS-encrypted OpenRouter key save/replace/remove and status-only reads; no plaintext fallback or provider requests. Unreadable credentials remain recoverable without blocking worker status.
- Fixed the observed Windows breakpoint crash by granting read/execute only to Electron's runtime directory for sandboxed application processes; renderer sandbox remains enabled. Reproduction/repair guidance is in `../README.md`.
- Verified on 2026-10-08: build/typecheck passed, 13/13 service/boundary tests passed, 3/3 actual Electron desktop tests passed. Inspected the rendered setup screen. Evidence and limits: `../validation/phase2.md`.
- Implemented native local-folder connection and HTTPS/SSH cloning into app-managed bare mirrors, with a stable selected branch and noninteractive existing Git authentication.
- Implemented 60-second commit-only background checks, manual sync, pause/cancel/retry and disconnect. Original checkouts are never changed; dirty/untracked files are excluded. Closing the app stops its jobs and enabled sync resumes on launch.
- Implemented committed-object inventories, hash-named source artifacts, RepoWise structural file records, explicit coverage, unchanged-record reuse, exact add/edit/rename/delete records and conservative transitive invalidation.
- Implemented per-file SQLite checkpoints, interrupted resume, immutable snapshots and a separate atomic publication pointer recovered across stale-settings crashes. Old published source remains intact during and after updates.
- Added the requested notification icon in the top nav and a separate right sidebar below it, with unread counts, timestamps, update/failure notices, persistent read state and keyboard close behavior. Unchanged checks remain quiet.
- Verified Phase 3 on 2026-10-08: 18/18 service tests, 4/4 Electron tests, build/typecheck and visual inspection passed. A resumed real public p-limit clone/fetch published commit `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`: 16 files with explicit coverage. Report: `../validation/phase3.md`.

- Implemented Phase 4 model settings, bounded host-only OpenRouter requests, strict output/citation validation, source-hash checks, heuristic secret filtering, checkpointed pages and persistent request/cost accounting.
- Added module/function/workflow documentation browsing, inferred/uncertain labels, source viewer, stale-commit warnings, manual resume/cancel and optional future-commit automation. Old documentation survives failed or budget-blocked replacement.
- Verified Phase 4: 22/22 service tests, 5/5 Electron desktop tests and build/typecheck passed; normal/narrow UI inspected. No paid requests were made. Evidence and limitations: `../validation/phase4.md`.

- Implemented Phase 5 source/path/symbol retrieval, bounded unresolved-call expansion and current-commit documentation source retrieval. Unique definition lookups are local; model answers require validated source citations and expose gaps.
- Added chat UI, pinned old-commit citations, limited same-commit question context, one retrieval expansion, a separate 32-entry retrieval cache and persistent exact-answer caches scoped to snapshot/model/policy/context/documentation state.
- Interactive questions preempt documentation and share its daily ledger. Cancellation, request limits, secret filtering and source verification remain enforced by the host.
- Verified Phase 5: 25/25 service tests, 6/6 actual Electron tests and build/typecheck passed. Normal/narrow chat views inspected. No paid calls; real model quality is unverified. Report: `../validation/phase5.md`.

- Implemented Phase 6 Repository, Documentation, Chat and Settings navigation, persistent repository/commit/job status, unified model settings, shared captured-source dialog and documentation-to-chat prefill. Drafts survive navigation and background sync; unsaved password input clears on leaving Settings.
- Verified Phase 6 build/typecheck, 25 service tests and seven Electron scenarios, including the actual 60-second background timer, old-source inspection, focus return, notifications and narrow layout. No paid calls. Report: `../validation/phase6.md`.

## In Progress

- No Phase 6 implementation remains. Live provider evaluation and packaging are Phase 7 work.

## Next Up

- **Phase 7: evaluation and packaging.** Complete developer-reviewed held-out evaluation, resource/recovery checks, measured quality/cost/latency and desktop distribution.
- Preserve commit-only refresh and consistent published evidence. Replace conservative dependency invalidation only when measured coverage justifies a narrower policy.
- Decide packaging targets before runtime distribution.

## Open Questions

- Repository entry now supports native local-folder selection and HTTPS/SSH remote clone. Upload is not included.
- Sync defaults selected after the clarification opportunity: current local/default remote branch unless explicitly entered, checks every 60 seconds while running, fetches into a private mirror, stops on app close and resumes on launch if enabled. No system tray/background daemon in this phase.
- Packaging targets and Python runtime distribution. Development launch is verified on Windows; other operating systems and installers are not yet validated.
- Confirmed: user selects the OpenRouter model in the app; generation starts manually. Defaults are 5 requests/run, 20/day (UTC), 2,000 output tokens/request and concurrency one. Request limits are not dollar caps. Live model quality/cost evaluation remains pending; OpenRouter is confirmed for embeddings; no paid calls were made.
- Phase 6 implements the dark/mint four-view design documented in `ui-context.md`; it is an implementation choice, not a claim of user design approval.
- Private/large/framework-heavy repositories for expanded held-out testing. Human developer review of the 50-question seed set remains pending for Phase 7.

## Architecture Decisions

- Electron desktop for one internal developer; no SaaS or collaboration features.
- React/Vite with plain CSS, sandboxed renderer, narrow preload and strict runtime-validated messages. Python service and encrypted credentials are host-controlled.
- App-managed bare mirrors and Git object reads protect source checkouts. Per-snapshot SQLite indexes and hash-named source files stage privately; `active.json` atomically publishes a validated version. Notifications/settings cannot override that pointer during recovery.
- OpenRouter for analysis/answers; knowledge stored locally with bounded external evidence requests.
- Background sync processes new commits only; uncommitted changes are excluded.
- RepoWise 0.55.0 behind a Python 3.12 adapter; reuse local SQLite/graph/lexical functionality. No extra graph/vector service without measured need.
- Read Git blobs/materialize isolated committed snapshots. The upstream commit-diff helper can read dirty checkout content.
- Maintain independent inventory and source/path fallback for nested JavaScript and configuration missed by upstream retrieval.
- Check actual grammar loading; package registration or an error-free empty parse does not establish structural coverage.
- Preserve historical tombstones but exclude them from active retrieval and scope caches by published snapshot.
- Host owns publication/job control. Feasibility probes do not replace production concurrent-query, cancellation and crash tests.
- Rules-based routing and exact caching remain the MVP approach; learned routing and semantic answer caching stay deferred.

## Session Notes

- Updated 2026-10-09 after Phase 6 completion. Documentation and cited chat are implemented and verified with fixture providers. Live paid generation, semantic answer quality, complete graph retrieval and packaging remain unvalidated.
- Report: `../validation/README.md`. Results: `phase1-evaluation-results.json`, `phase1-supplement-results.json`, `phase1-lifecycle-results.json`, `phase1-recovery-results.json` under validation/.
- Runtime/source/logs/fixtures are ignored under .research/. The usable Python interpreter path is documented in the report; do not ship its machine-specific path.
- Latest retrieval p50/p95: 259.24/401.2 ms in one local sequential run with supplied queries. This is not an app performance guarantee. Mock embeddings are not semantic-search validation.
- Source review was by the coding agent. Do not label the seed set human-approved or describe file retrieval as 45/45 correct generated answers.
- Research: https://docs.google.com/document/d/16BI9FrKEhSrEYTgha5jqpXwUHmKv3J1QI4u-1H4rCSc/edit?tab=t.0
- Visual reference: `../codebase_intelligence_architecture.png`.
- `npm run build`, `npm test` and `npm run test:desktop -- --max-failures=1` passed for Phase 2. Desktop checks used host permissions for native launch/OS encryption and isolated fake-key test data. Run the application with `npm start` after building; setup and runtime overrides are in `../README.md`.
- Phase 3 final checks: `npm test` passed 18 tests; `npm run test:desktop -- --max-failures=1` rebuilt and passed 4 tests. Public remote verification required recovery from intermittent TLS transport failures; bounded retries and visible errors are implemented without disabling verification. Private-auth/SSH servers, cross-platform packaging and power-loss durability are not validated. Old snapshots/staging are retained; cleanup is not yet implemented.


## Requested workspace and retrieval extension (2026-10-09)

- Confirmed OpenRouter for embeddings. Implemented searchable chat/documentation and embedding model catalogs in Settings, explicit refresh, context/pricing display, manual ID fallback and persisted separate embedding selection. Saving/listing models does not generate embeddings.
- Remaining requested work: local vector index in the workspace; incremental embedding publication; sequential vector -> KG -> code retrieval based on evidence sufficiency. These supersede the prior deferral of semantic retrieval and must be completed before packaging.
- Embedding implementation must reuse unchanged content hashes, replace changed chunks, remove deleted chunks from the new version, retain old query snapshots during staging, and rebuild on embedding-model/dimension/chunk-policy changes. Documentation generation remains manual by default.

- Model catalog validation: build/typecheck and 27/27 service tests passed; three foundation Electron checks and the targeted model-selection/persistence/failure-recovery scenario passed. Fixture providers only, no paid requests. Public catalog documentation was checked; direct live Node catalog access failed in this restricted environment.

- Implemented full-section chatbot Chat with a fixed composer, keyboard submission and scrollable cited conversation; implemented Repository/Knowledge Graph subviews with live React Flow checkpoint visualization, search, node details, pan/zoom/minimap and explicit unresolved/omitted records. Graph preview is read-only and separate from chat evidence.

- Chat/KG verification: build/typecheck, 28/28 service tests and 9/9 Electron scenarios passed. Normal graph and narrow chat screenshots inspected. Report: `../validation/chat-graph.md`. No paid requests.

- Implemented workspace picker persistence and Open workspace folder, per-repository private clone storage, versioned browsable committed source, automatic/manual Markdown exports with module/function/workflow pages, latest index and personal-notes preservation. Existing connections can be copied into a new workspace without moving/deleting their earlier data. Internal indexes/ledgers/credentials stay in app data. Windows long-path support and destination-local clone staging are enabled.

- Workspace verification: build/typecheck, 30/30 service tests and 10/10 Electron scenarios passed (2.3-minute desktop suite), including picker cancellation/persistence and actual Markdown export. Picker screenshot inspected. Report: `../validation/workspace-storage.md`.

- Added per-answer confidence/data-used footers. Scores are explicit host-computed evidence estimates; expandable details show reasons and retained source paths/lines. Document/KG badges reflect contributing retrieval evidence, and chat v2 cache keys prevent reuse of old answers without provenance.

- Answer-footer verification: build/typecheck, 32/32 service tests and the targeted Electron chat scenario passed; inspected the rendered footer. Tests cover heuristic score differences, retained document provenance, graph route without contributing edges, direct/model/insufficient answers and cache reuse. No paid calls.

- Fixed rejection of valid OpenRouter responses with null cost; added actionable sanitized generation diagnostics and visible error/debug context. Failed document responses now retain provider-reported cost. Verified build/typecheck, 34/34 service tests and both targeted Electron documentation/chat scenarios, including truncation followed by explicit successful resume. No paid requests; the original screenshot failure cannot be identified retrospectively because the earlier implementation discarded its cause. Report: `../validation/generation-errors.md`.

- Ollama verification complete: build/typecheck, 33/33 service tests and all 10 Electron scenarios passed across targeted runs. Inspected installed-model Settings UI. Real local inference was not run because the server was unreachable on port 11434; no model was downloaded. Setup and limitations: `../validation/ollama.md`.


## Chat without documents — 2026-10-11

Implemented explicit no-document fallback reporting and chat evidence trail; created a committed Python shop demo under examples/shop-demo and questions/expected answers in examples/TESTING.md outside the repository. Build and three chat service regressions passed. Live Ollama probe failed, including outside the sandbox; Ollama was not found on PATH or at its usual per-user install location. Live model verification remains blocked; fixture tests do not establish semantic answer quality.

Electron verification also passed: chat answered through the Ollama fixture with zero published documents, displayed the missing-document trail, and retained citations. Screenshot: test-results/chat-document-fallback.png.


## Full UI redesign — 2026-10-11

Replaced the dense dark presentation with a light/slate/blue visual system across repository, documentation, chat, settings, notifications, source dialogs and graph. Added icon navigation, moved status to a compact footer, reorganized Settings around models first with section shortcuts, reduced repeated headings and collapsed chat metadata. Build passed. Three Electron scenarios passed covering graph publication, provider switching, navigation/drafts, source citations, responsive chat and automatic background sync. Visual review covered desktop and 780px chat. The final graph and provider scenarios also passed after the light-graph update; Settings, Documentation and graph screenshots were visually inspected. No provider inference was used.

## Example cleanup — 2026-10-11

Removed the user-requested shop demo, its nested Git repository and examples/TESTING.md. Earlier demo creation entries are historical; those files are no longer available. Application regression fixtures remain unchanged.


## Broad repository questions — 2026-10-12

Implemented broader natural-language retrieval, cross-file candidate diversity, contextual follow-up retrieval, explicit bounded graph relationship context and broader evidence-grounded answer instructions. Build and eight deterministic retrieval cases passed, covering overview, launch, configuration, security, dependencies, storage, tests and missing features. All 46 service tests and the Electron graph/chat/pause scenario passed. Final targeted retrieval/follow-up checks passed after the last adjustments. Live Ollama semantic quality remains unverified; this does not complete the pending external RepoWise MCP migration.
