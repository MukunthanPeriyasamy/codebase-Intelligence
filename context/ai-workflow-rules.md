# AI Workflow Rules

## Multilingual documentation and schema-first retrieval — 2026-10-16

The user's latest scope is language-independent, superseding Python-only function coverage. Python AST facts are supplemented by pinned bundled Tree-sitter grammars and language adapters for the configured programming languages; HTML/Vue/Svelte script blocks are parsed too. Unknown language text keeps numbered evidence and model analysis with explicit coverage gaps. No universal semantic/runtime completeness claim is made.

Wiki caches now store a document-only schema: Frontend, Backend, Databases, API, Domain, Business, Application, Configuration, Tests and General, with page/file/chunk/source-range metadata. Chat builds/validates this index from cached documents, searches requested areas and documented connections, then cross-checks only their referenced source. Broader retrieval remains document-only. Answers are returned normally; modification proposals require Accept before writing and Reject preserves source. Missing documents retain the exact stop message. See `../validation/function-documentation.md`.

## Function-level documentation coverage — 2026-10-15

Fresh wiki generation appends source-derived reference pages, independently of top-k model retrieval. Python AST analysis inventories every parsed function/method/nested function/lambda, signatures, defaults/types, returns/yields, calls and argument expressions, candidate callers/result consumers, imports, and try/error/cleanup blocks. Numbered source continuations preserve all selected readable file lines. Other languages receive complete numbered slices and per-slice model analysis; their function coverage is explicitly unverified. Domain/business/data/application candidates are identified with their evidence limits. Runtime values and dynamic dispatch are not invented.

Connected Python import/caller paths are included in documentation provenance for document-first edit retrieval. File filters are passed by keyword; source context omissions are explicit. Existing caches need Refresh Wiki. Keep Accept/Reject and no-document boundaries intact. Details and verification: `../validation/function-documentation.md`.

## Document-first workflow correction — 2026-10-15

This supersedes earlier source-first chat/edit retrieval descriptions. Interactive Fast, Deep Research, Codemap and Edit code first retrieve relevant chunks from the repository's generated wiki in the requested language. Missing, empty, unrelated or wrong-repository documentation stops with `No document Found Generate One`, before source access or inference. Current source is cross-checked only for files referenced by those chunks. Wiki generation retains its source-based bootstrap.

Edit proposals use original numbered source line ranges, validate the resulting diff without writing, and record documentation provenance. Only explicit Accept applies the stored proposal after a stale-source check; Reject leaves current files unchanged. Older proposals lacking document evidence cannot be accepted. One validation-correction attempt is permitted for local Ollama. Chat history remains browser-local and repository-scoped. See `../validation/chat-editing.md` for verification and limitations.

## Approved chat editing and persistent history — 2026-10-15

The user explicitly approved implementing code modification capabilities with an Accept/Reject diff review. The old prohibition on modifying analyzed repositories is superseded only for user-accepted proposals. Generation/research/chat alone must never mutate source. Keep current DeepWiki architecture and Ollama support. Document and verify review boundaries and persistent conversation behavior.


## Current direction: complete DeepWiki — 2026-10-14

Follow the full DeepWiki application direction. Do not restore the old Electron shell or custom RepoWise/LanceDB adapter unless requested. Keep Ollama working without paid API keys. Preserve user data and distinguish deterministic fixture verification from live model quality. Earlier Electron-specific restrictions and the documentation pause are superseded by the user request for complete DeepWiki.

This decision supersedes conflicting historical implementation notes below. See `../README.md` and `../validation/full-deepwiki.md`.

## DeepWiki backend migration — 2026-10-13

The latest user-approved scope replaces backend indexing/retrieval/context with adapted DeepWiki components; preserve the interface and commit/citation invariants. Do not describe this as the unmodified upstream service: host Git/provider/accounting and RepoWise/LanceDB adapters remain intentional. Do not treat old vector manifests as ready for the new profile. Use pinned setup per computer and distinguish fixture checks from live model quality.

This supersedes older backend-selection notes below. Details: `../validation/deepwiki-pipeline.md`.

## Code-vector RAG and separate RepoWise tool (2026-10-12)

The current implementation keeps RepoWise 0.55.0 behind a separately installed local MCP adapter for parsing and graph evidence. Setup is per computer, outside the application runtime. This supersedes the older pending-deployment-choice notes below. It is our adapter, not the complete upstream MCP/chat server.

Code embeddings now run through Ollama or OpenRouter and are stored in LanceDB. Settings > Code search builds/resumes/cancels the index after saving an embedding model. Chat merges semantic matches, lexical retrieval and graph expansion, then supplies verified source excerpts and bounded relationships. Provider/model/commit identities are isolated; unchanged embeddings are reused and deleted files are absent from newer snapshot searches. Completed local indexing opts the repository into indexing future commits; remote indexing stays manual and shares the daily request budget. Documentation generation remains paused. Embedding selection alone sends no requests.

Upstream RepoWise does implement hybrid retrieval, context hydration and answer synthesis, largely over wiki pages; those full pipelines have not been imported into the app. Existing graph links remain unresolved name matches, and vector retrieval does not guarantee answer correctness. Live model-quality evaluation is still pending. Architecture, setup, limits and audit: `../validation/code-vector-rag.md`.

## Current direction — code/KG chat and external RepoWise MCP (2026-10-11)

User paused documentation generation and requested RepoWise as an external MCP tool rather than an application dependency. Production host now blocks manual/automatic document generation, preserves existing documents and excludes documentation from chat retrieval. Chat continues using committed source and existing graph evidence. Build and targeted pause/retrieval tests passed. RepoWise MCP availability is verified, but migration is NOT implemented: server location (separate local tool or remote server), index lifecycle and commit-bound evidence validation must be resolved before replacing the current adapter. Existing Python/RepoWise analysis remains in place until a tested replacement is ready. Do not describe MCP as active or remove the working index prematurely. This supersedes earlier active-generation scope.

## Current providers — Ollama and OpenRouter (2026-10-10)

The latest user request restores OpenRouter alongside Ollama; neither replaces the other. Preserve existing local profiles, manual-generation default, commit/citation invariants and historical documents. Provider switching must not trigger paid calls or reuse answers from another provider. Embedding selection is configuration only until the vector pipeline is implemented. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

The latest explicit user request replaces OpenRouter with local Ollama. Earlier OpenRouter decisions below are historical. Preserve source/citation invariants and existing publications. Model downloads remain a user setup action; connection checks and catalog refresh never invoke inference. Embedding selection does not mark the vector pipeline complete. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

## Approach

Build incrementally against these context files. Read the overview, architecture, standards, UI context, build phases, and progress tracker before implementation. The user's latest explicit decisions take precedence over the earlier research and diagram. Keep confirmed requirements separate from proposed or undecided implementation choices. Follow `build-phases.md` and distinguish validation evidence from completed product features. Phase 4 implements documentation generation and citation browsing. The user explicitly chose model selection in the app and manual generation initially; do not enable paid generation by default. Background source sync remains automatic on new commits. Cited chat is implemented in Phase 5, using the saved model and shared request budget. Phase 6 has completed the integrated desktop workflow and fixture-provider verification. Phase 7 is next: live provider quality evaluation, measured limits and packaging. Do not treat fixture-provider responses as evidence of real model answer quality.

## Scoping Rules

- Work on one feature unit at a time
- Prefer small, verifiable increments over large
  speculative changes
- Do not combine unrelated system boundaries in a
  single implementation step

## When to Split Work

Split an implementation step if it combines:

- Unrelated desktop presentation and background-analysis changes
- Multiple independent ingestion, retrieval, or publication concerns
- Undefined product behaviour alongside implementation of already defined behaviour

If a change cannot be verified end to end quickly,
the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the
  context files
- If a requirement is ambiguous, resolve it in the
  relevant context file before implementing
- If a requirement is missing, record it in `progress-tracker.md`; resolve consequential ambiguity with the user before dependent implementation while continuing independent work.

## Protected Files

Do not modify the following unless explicitly instructed:

- The supplied workflow image and linked research document are reference material; preserve them unless the user requests changes.
- Repositories being analyzed are read-only inputs, including their source and Git state.
- Third-party library internals should remain unchanged; extend through adapters unless a change is explicitly requested.

## Keeping Docs in Sync

Update the relevant context file whenever implementation
changes:

- System architecture or boundaries
- Storage model decisions
- Code conventions or standards
- Feature scope

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope
2. No invariant defined in `architecture.md` was violated
3. `progress-tracker.md` reflects the completed work
4. Once scaffolding defines it, `npm run build` passes along with checks relevant to the change; before scaffolding, do not claim unavailable build or test commands have passed.

The latest user scope adds OpenRouter embeddings, model catalogs, workspace storage, sequential vector/KG/source retrieval and KG/Chat presentation changes before packaging. Track each unit separately; do not claim the vector pipeline is active merely because an embedding model can be selected. Preserve manual documentation generation and use fixture providers for tests.

Full-section Chat and live KG presentation are now implemented. Keep their preview data separate from retrieval evidence and keep remaining workspace/vector work marked pending. Verify future changes against the graph and chat desktop regressions.

Workspace selection and Markdown exports are implemented. Preserve older exports and personal notes; do not describe user-visible source copies as the authoritative analysis snapshot. Do not claim vectors are generated by Markdown export. Keep vector lifecycle/routing tracked separately.
