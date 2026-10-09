# Architecture Context

## Latest provider decision — Ollama (2026-10-09)

The host uses fixed http://127.0.0.1:11434 endpoints: GET /api/tags, POST /api/show for capabilities/local-only verification, and POST /api/chat with JSON-schema format, stream=false, num_ctx=32768, saved num_predict, temperature=0 and think=false for thinking-capable models. Redirects and Ollama cloud models are rejected. Catalog responses and completions are bounded to 2 MiB; catalog traversal is limited to 100 models/30 seconds and inference to 10 minutes. Chat allows 21 minutes for two bounded calls. Credential bridge/storage code is removed; old encrypted files are left unused. Legacy settings are backed up to settings.before-ollama.json, reset to manual local setup with no selected model, and retain historical accounting and publications. New job/cache identities include Ollama. Old Markdown/citations remain readable. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

## Stack

| Layer     | Technology                  | Role   |
| --------- | --------------------------- | ------ |
| Desktop | Electron | Single-developer desktop shell and privileged host operations |
| UI | React + Vite, strict TypeScript, plain CSS tokens | Repository sync, notifications, settings, documentation, source viewer and cited chat |
| Analysis | RepoWise 0.55.0, commit `7f84ae07908de40595fc64b3fe3c910123367a1e`, selected behind an adapter | Phase 1 persisted indexing/retrieval and update probes complete; isolated snapshots, source fallback and explicit coverage required |
| Models | OpenRouter; user-selected model ID in the app | Behavioural records and evidence-grounded answers |
| Workers | Python 3.12, launched by Electron main through versioned private JSON messages | Lifecycle/health, committed analysis, incremental snapshots and bounded evidence retrieval implemented |
| Storage | Local SQLite metadata and immutable files; reuse RepoWise graph/lexical persistence behind the adapter | Evidence, jobs, search and caches; no additional graph/vector service selected |
| Versioning | Git | Immutable commit snapshots and change detection |

## System Boundaries

Physical boundaries: `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, and `worker/`. Tests live in `tests/`; build scripts in `scripts/`. Required logical boundaries are:

- Electron main/preload: repository access, credential handling, worker lifecycle, and a narrow validated renderer bridge.
- Python adapter design: `../validation/adapter-contract.md`. Version-one JSON-lines health/shutdown and snapshot-job messages have 64 KiB message limits and validated responses. Snapshot jobs run in a separate bounded Python process and checkpoint each file. RepoWise 0.55.0 parses committed bytes behind the adapter; actual grammar availability, empty extraction, parse failures and unsupported text have explicit coverage. Raw stderr is drained without forwarding sensitive content. Model generation runs asynchronously in the TypeScript host; Phase 5 adds bounded retrieval over stored unresolved call sites; complete graph resolution remains unvalidated.
- Renderer: documentation, source citations, chat, settings, and status presentation; no direct filesystem, Git, or stored model-secret access. A password input sends a transient key to the host and clears on submission. Preload exposes status/subscription, worker restart/stop, credential save/clear, native local-folder selection, remote connection, sync/cancel/auto/disconnect, and notification-read actions. No arbitrary path or Git command bridge exists. Strict Zod schemas validate bridge and worker messages. Only the exact application main frame may call host services.
- Analysis and publication: snapshot inventory → structural analysis → bounded behavioural records → validation/document assembly → indexing and atomic publication.
- Retrieval and answering: snapshot binding → exact cache → rules-based plan → targeted retrieval → compact evidence → answer/evidence checks → cited result. Expand retrieval once when needed, then escalate if configured or report the gap.
- Background sync: detect new commits, compare with the indexed snapshot, invalidate changed and affected records, and rebuild through the same publication pipeline. Never stage, commit, reset, or alter the user's checkout. The pinned RepoWise change detector can read new content from a dirty working tree even for commit-range diffs; use Git blobs and isolated committed snapshots for filesystem-dependent analysis. This mismatch was reproduced in `validation/repowise-baseline.py`.
- Phase 3 sync defaults: local folder or HTTPS/SSH clone, one connected repository, explicit branch or current-local/default-remote branch resolved once. Fetch the selected branch into a private bare mirror every 60 seconds while running; local connections fetch local commits, remote connections fetch remote commits. No remote fetch into the user's checkout. Manual sync, cancel/retry, auto-sync toggle and disconnect are available. Closing the app stops processes; enabled sync resumes on launch. A branch rewind without new reachable commits preserves the published snapshot and reports an error; reconnect explicitly to follow older history.

## Storage Model

- Phase 2 initializes user-data `knowledge/metadata.sqlite3` in WAL mode with schema version 1 and an `app_metadata` table. Phase 3 stores inventory, symbols, unresolved call sites, exact Git changes and conservative invalidation records in each snapshot's `index.sqlite3`. Source is stored in SHA-256-named files; repository paths are database keys, never filesystem output paths. Symlinks/submodules are inventoried but never followed. Development runtime/data-directory overrides are host-only; Python bundling remains packaging work.
- Repository settings, pending commit and the latest 100 notifications/read states persist in `knowledge/repository-state.json`. App-managed mirrors, staging checkpoints and retained immutable snapshots live under `knowledge/repositories/<id>/`. Per-repository `active.json` is the publication authority: rename a validated staging directory, then atomically replace this pointer. Startup recovers the pointer even if a crash preceded settings persistence. Prior snapshots remain intact; garbage collection is not implemented.
- Unchanged file records are reused only when path, Git object, mode, analyzer version and stored source hash match. Renamed paths get new symbol identities; removed files disappear from the new inventory. Until cross-language dependencies are complete, every derived file record (including removed/renamed paths) is conservatively invalidated on a change. This trades extra future regeneration for avoiding missed transitive dependencies; it does not claim a precise complete call graph.
- Snapshot bounds: 100,000 entries, 2 MiB per captured file, 512 MiB eligible source and a 15-minute job timeout. Oversized/binary/non-UTF-8 files and dependency/generated directories have explicit exclusions. Unsupported UTF-8 text is retained for later source retrieval. Per-file SQLite checkpoints survive cancellation/failure; retry resumes verified records. Windows long paths are supported for hash-named source artifacts.
- Bundled renderer assets use an allowlisted `codebase://app` protocol and restrictive CSP. Electron enables sandbox/context isolation and denies permissions, navigation, webviews and new windows. The foundation requires no renderer network access.

- **Local metadata and indexes**: repository/commit IDs, file inventory/status, symbols, relationships with resolution provenance, behavioural records, jobs/checkpoints, and published-version pointers. Reuse RepoWise storage/search where validated; do not add a separate graph/vector store without a demonstrated need.
- **Local snapshot/artifact storage**: immutable committed source, generated documentation, and associated evidence. Records link repo_id, commit_sha, symbol_id, path, line span, source/dependency hashes, and analyzer/model/prompt versions.
- **Caches**: parsing by content/parser version; analysis by source/dependency/model/prompt versions; embeddings by content/embedding-model version; retrieval and exact answers separately. Exact answers also include scope, index version, effective question/conversation state, and retrieval policy. TTL alone does not establish freshness.
- **Publication**: stage and validate the next version before atomically activating it. Keep the prior published snapshot queryable while rebuilding. Invalidate removed symbols and dependent records across all affected indexes and caches.
- **Retrieval coverage**: exclude upstream tombstoned pages from the active version. Maintain independent full inventory and source/path lookup for nested symbols and configuration missed by upstream retrieval.

## Auth and Access Model

- One local developer; no application accounts, team roles, or collaboration service are required.
- Repository selection establishes the accessible local scope. Validate repository and snapshot identifiers on host operations and cache reuse.
- Store OpenRouter credentials using Electron `safeStorage` OS encryption in user-data `credentials/openrouter.enc`, atomically replacing encrypted bytes. No plaintext fallback; Linux `basic_text` is refused. Never return stored secrets to the renderer, put them in repository files/logs, or inherit them into the worker environment. Transient password input is the only renderer credential handling; key validity is not checked by a model request in Phase 2.
- Send only relevant, bounded evidence to OpenRouter, with secret filtering before external calls. Treat repository content and model output as untrusted data.

## Invariants

1. Only committed snapshots enter knowledge storage. Uncommitted files, staging changes, and untracked files do not trigger content indexing.
2. Every query, citation, record, and cache entry is bound to a consistent repository/snapshot; a query cannot mix old and newly building evidence.
3. Source is authoritative. Documentation is a derived view; claims distinguish extracted, inferred, test-supported, and unresolved evidence.
4. Broad language acceptance does not imply complete structural support. Inventory all files and expose exclusions, unsupported constructs, failures, and relationship uncertainty.
5. Long-running work stays outside the renderer and uses bounded concurrency, cancellation, retries, checkpoints, and visible failures. Interactive queries take priority over documentation work.
6. New commits trigger background incremental processing, including conservative affected-record invalidation and deletions/renames. Check the selected source branch every 60 seconds while running; never modify the source checkout.
7. Publish validated versions atomically; do not report documentation complete while eligible jobs remain unfinished without explicit gaps.
8. Never send the full repository by default, execute repository code, or mutate its source. Permissions, budgets, schema checks, and freshness are enforced in application code, not delegated to model confidence.

## Phase 4 documentation boundary

- `src/main/documentation.ts` owns job checkpoints, request/cost accounting and atomic per-repository publication. Keys scope repository, commit, analyzer, model, prompt version and output limit. Conservative invalidation regenerates documentation for every new commit; source parsing still reuses unchanged files.
- `worker/evidence.py` verifies immutable source hashes and supplies bounded snippets. `src/main/evidence.ts` filters common secrets, validates quotes/spans and function references. Citation reads resolve against the stored page snapshot, including stale published versions. Integrity validation does not establish semantic correctness.
- `src/main/openrouter.ts` alone decrypts/uses the host-provided key for a fixed HTTPS completion endpoint. JSON-schema output, 16,000-byte evidence, 128 KiB response, 60-second timeout and one concurrent request bound the operation. No automatic paid-call retries.
- `knowledge/documentation/settings.json` holds settings and the UTC daily request ledger, never the key. Per-repository `jobs/<key>/job.json` and `pages/<id>.json` checkpoint progress; `published.json` selects a validated publication. Old documentation remains available if replacement fails or runs out of budget before producing a page. New commits abort obsolete generation.
- Manual generation is the default. Optional future-commit automation uses the same limits and does not retry an existing paid job after interruption. Defaults are 5 requests/run, 20/day and 2,000 output tokens; these do not impose a dollar cap. Unknown-cost attempts remain visible.
- The bridge exposes only validated configuration/generate/cancel/catalog/page/citation actions. Model content and source render as plain React text. Browsing and citations remain available during generation.

## Phase 5 retrieval and chat boundary

- `worker/retrieval.py` runs through the existing read-only evidence process. It ranks symbols, paths and lexical source, caps metadata/source work, and expands unresolved call sites by name for at most two hops and 24 edges. It does not claim resolved imports or runtime edges. Limits are recorded in `../validation/phase5.md`.
- `src/main/retrieval.ts` validates retrieval responses, maintains a separate 32-entry memory cache and packs at most six hash-verified, filtered source excerpts. Documentation contributes captured source only from the same commit; derived model claims do not become authoritative evidence.
- `src/main/chat.ts` binds each question to a snapshot, tries the exact cache, executes the rules-based plan, uses local unique-definition answers or a bounded provider answer, validates it and publishes it to the current session. Up to three same-commit previous questions form context; previous answers are not sent as proof. One expansion and at most two provider requests are allowed, with a three-minute query deadline.
- `src/main/chat-provider.ts` uses the shared fixed-endpoint OpenRouter transport and strict output schema. The existing documentation settings/key and durable daily ledger are shared. An exclusive interactive reservation pauses documentation, blocks simultaneous generation/settings changes and releases on success, failure or cancellation. No automatic resume of paid documentation follows chat.
- Persistent exact answers live under `knowledge/chat/<repoId>/<fingerprint>.json`. Keys include the complete snapshot reference, question, effective question history, model/output limit, policy/prompt version and current documentation fingerprint. Cache hits re-read source and validate hashes, text, redactions and citations. Corruption fails closed. No cross-version or semantic cache reuse is used.
- The session retains twenty answers with their source references; new commits exclude old questions from new context but allow old answers/citations to remain visible. Switching repositories aborts pending chat and hides old scope. Restart starts a fresh conversation while retaining exact cache artifacts. The bridge exposes ask/cancel/clear/citation only, with bounded input and citation indices.

## Phase 6 presentation integration

- Four renderer views share the existing status subscription and validated preload operations. Settings owns credential/engine presentation and shared model controls; host request budgets, priority and publication remain authoritative. No privileged bridge action or storage schema was added.
- A renderer-only source selection carries validated evidence, commit and origin to the shared modal. Citation requests still resolve through the host against the stored snapshot; navigating away prevents a late citation response from opening in another view. Repository changes clear the source selection.
- Navigation preserves mounted UI state and per-view scroll positions during the session. Documentation-to-chat prefill is local state only; the developer must submit the question.

## OpenRouter catalog and planned embedding extension

Settings lists text-capable models through host-only GET requests to fixed `/api/v1/models` and `/api/v1/embeddings/models` endpoints. Responses are bounded to 16 MiB and 20 seconds, validated and reduced before crossing IPC. A saved key is optional for catalog lookup and never returned to the renderer. Separate optional `embeddingModel` metadata preserves compatibility with old ledgers. Catalog refresh failures preserve UI selections; manual IDs remain supported.

The user now requests OpenRouter document embeddings and vector-first, then KG, then source retrieval. This is approved scope, not implemented retrieval yet. A versioned local index must use repository/document/chunk identities and content hashes, with embedding model, dimensions and chunk-policy versions. Stage changed embeddings and deletions, validate dimensions/finiteness/scope, then atomically publish a manifest; never mutate an index used by an active query. Query embeddings must use the same model/dimensions. Changed model or chunk policy requires a full rebuild.

## Read-only graph dashboard

`repository.graph` is a strict no-argument bridge action. The host selects the connected repository’s current staging checkpoint during indexing, otherwise its published snapshot. `GraphReader` invokes bundled `worker/graph.py` with the existing bounded, minimal-environment subprocess transport. The worker opens SQLite read-only, uses one read transaction and checks the commit; published reads also require the complete flag. Preview data is exclusively for visualization and never enters retrieval/citations.

The graph exposes at most 60 inventoried files, 20 symbols and 20 call records per file, 240 nodes and 400 edges, with omission indicators. File-to-symbol containment is extracted structure; calls point to explicitly unresolved target-name nodes. No cross-file or runtime resolution is invented. The host validates endpoint references and scopes responses to the connected repository; only one graph subprocess request runs at a time and shutdown aborts it. Existing query publication remains unchanged.

## User-selected workspace storage

The native workspace picker remembers a canonical folder in the existing repository settings file. Each connection gets an exclusively created `repo-<name>-<suffix>/` project; a connected repository can be copied to another selected workspace without deleting the original. Its private bare mirror lives in `.codebase-intelligence/mirror.git`, and clone staging stays beside that mirror for same-volume publication. Git operations enable Windows long-path support.

Browsable source is cloned into a fresh `repository/<commit>-<uuid>/` directory and checked out at the captured commit, with symlink materialization disabled. Each source export is recorded in private metadata; later commits never overwrite older copies. The original local checkout remains untouched. Authoritative immutable analysis snapshots, chat caches, generation checkpoints, budgets and encrypted credentials remain in app data; user-visible source copies are not retrieval inputs.

Validated documentation is exported as Markdown to `docs/versions/<commit-prefix>-<uuid>/`, organized into modules, functions and workflows with a generation README. `docs/README.md` is replaced last as the latest-generation entry point. It includes commit, remaining work and omission counts. Earlier generations and `notes/` remain untouched. Export failure leaves previous Markdown usable; the app publication remains available and export can be retried without paid generation. New no-argument bridge actions select/open the host-chosen workspace and export published docs; renderer-supplied paths remain prohibited.

## Answer quality metadata

Chat v2 persists host-computed quality metadata alongside each answer and scopes cache keys to the new version. The evidence packer records document origin only for accepted excerpts; rejected/deduplicated candidates do not count. Source labels are derived from final retained evidence after budget trimming. KG contribution requires an unresolved edge whose path/line lies in retained evidence, not merely a graph routing label. Current source excerpts are always labelled Codebase; Document and KG indicate retrieval guidance, not independent authoritative model claims.

The evidence-confidence heuristic is 95 for a verified unique definition location, zero for insufficient evidence, and for validated model answers starts at 85 minus up to 20 for uncertain-claim proportion, up to 20 for distinct reported gaps (5 each), and 10 for retained unresolved KG relationships; floor 10. It is not calibrated semantic correctness and is not used as a retrieval-routing threshold.

## Provider failure diagnostics

The bounded completion adapter accepts nullable cost metadata and distinguishes HTTP rejection, transport/timeout failure, response-size/JSON/envelope failure, truncation, refusal, empty output and document-schema rejection. Diagnostics contain fixed text, schema issue codes and numeric token limits/usage; raw provider bodies and secret-bearing validation values never cross IPC. Documentation records reported cost even when provider output fails validation. Existing notification persistence retains failure summaries; paid calls are never retried automatically.
