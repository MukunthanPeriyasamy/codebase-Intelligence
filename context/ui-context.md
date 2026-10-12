# UI Context

## Code-vector RAG and separate RepoWise tool (2026-10-12)

The current implementation keeps RepoWise 0.55.0 behind a separately installed local MCP adapter for parsing and graph evidence. Setup is per computer, outside the application runtime. This supersedes the older pending-deployment-choice notes below. It is our adapter, not the complete upstream MCP/chat server.

Code embeddings now run through Ollama or OpenRouter and are stored in LanceDB. Settings > Code search builds/resumes/cancels the index after saving an embedding model. Chat merges semantic matches, lexical retrieval and graph expansion, then supplies verified source excerpts and bounded relationships. Provider/model/commit identities are isolated; unchanged embeddings are reused and deleted files are absent from newer snapshot searches. Completed local indexing opts the repository into indexing future commits; remote indexing stays manual and shares the daily request budget. Documentation generation remains paused. Embedding selection alone sends no requests.

Upstream RepoWise does implement hybrid retrieval, context hydration and answer synthesis, largely over wiki pages; those full pipelines have not been imported into the app. Existing graph links remain unresolved name matches, and vector retrieval does not guarantee answer correctness. Live model-quality evaluation is still pending. Architecture, setup, limits and audit: `../validation/code-vector-rag.md`.

## Current direction — code/KG chat and external RepoWise MCP (2026-10-11)

User paused documentation generation and requested RepoWise as an external MCP tool rather than an application dependency. Production host now blocks manual/automatic document generation, preserves existing documents and excludes documentation from chat retrieval. Chat continues using committed source and existing graph evidence. Build and targeted pause/retrieval tests passed. RepoWise MCP availability is verified, but migration is NOT implemented: server location (separate local tool or remote server), index lifecycle and commit-bound evidence validation must be resolved before replacing the current adapter. Existing Python/RepoWise analysis remains in place until a tested replacement is ready. Do not describe MCP as active or remove the working index prematurely. This supersedes earlier active-generation scope.

## Full interface redesign — 2026-10-11

The current design supersedes the earlier dark/mint theme. `src/renderer/redesign.css` layers the new visual system over existing component layout styles: light gray workspace (#f5f7fb), white surfaces, slate sidebar (#17243b), blue primary actions (#315ee7), dark readable text (#1b2940), muted text (#607086), subtle borders and consistent rounded controls. Navigation uses labeled outline icons and a clear active state. The repository/branch header stays at the top; job/request status is a compact bottom bar. Redundant section numbers and promotional heading text are removed.

Repository and documentation use simpler cards and clearer action hierarchy. Settings opens with model selection and limits, provides in-page section shortcuts, then connection controls and the analysis engine. Chat has a centered reading column, quiet user bubbles, a fixed composer, collapsed answer metadata and visible evidence/confidence. The graph uses light mode. Source dialogs and notifications follow the new theme. The layout adapts at narrow desktop widths; keyboard focus, native controls, preserved drafts and citations remain intact.

Verification: build and Electron graph, provider-switching and complete-workspace scenarios passed, including 780px layouts and automatic background sync. Screenshots are generated under test-results. Earlier visual specifications below describe historical phases.


## Current providers — Ollama and OpenRouter (2026-10-10)

Settings offers both Connect Ollama and Connect OpenRouter (save/remove encrypted key), plus a Model provider selector in Generation settings. Model catalogs, labels and prices match the selected draft provider; Save applies it. Model and embedding selections are remembered separately per provider. Active provider is visible in documentation/chat, output caps remain explicit, and switching provider disables automatic generation. Unsaved key input clears when leaving Settings. This supersedes earlier Ollama-only or OpenRouter-only instructions; historical verification entries remain historical.

## Python compatibility update — 2026-10-10

Python 3.14 is now supported alongside 3.12; this supersedes earlier 3.12-only runtime requirements. Verified CPython 3.14.2 with unchanged pinned RepoWise/dependencies: 34 service tests, four Electron checks and identical parser counts/diagnostics on 61 fixtures across 15 tags compared with 3.12.14. Worker and snapshot gates, IPC validation, UI messages and setup script were updated. Other minor versions are not enabled. Setup and limits: `../validation/python314.md`.

## Latest provider decision — Ollama (2026-10-09)

Settings now provides Connect Ollama with a Test Ollama connection button, fixed local endpoint and installation instructions. Chat/document and embedding pickers show installed capability-filtered models; API-key and provider-price controls are removed. Saved output limits appear in Settings and Documentation. Defaults for new/migrated settings are manual generation, one request/run, 20/day and 8000 output tokens; maximum is 16384. Local model inference may take up to 10 minutes per request. This supersedes earlier OpenRouter-specific runtime instructions; earlier completed-work entries remain historical.

## Theme

An Electron desktop workspace for one developer, centered on readable documentation, source evidence, and chat. Phase 6 implements a dark neutral theme with mint accents, selected as an implementation default rather than a user-approved design. The supplied architecture image describes workflow; it is not an approved application mockup. The integrated desktop workflow is implemented.

## Colors

Use centralized CSS custom properties in `src/renderer/styles.css`. These are the implemented foundation values, not colors inferred from the architecture image.

| Role            | CSS Variable       | Value    |
| --------------- | ------------------ | -------- |
| Page background | `--bg-base`        | `#101416` |
| Surface         | `--bg-surface`     | `#191e21` |
| Primary text    | `--text-primary`   | `#edf2ef` |
| Muted text      | `--text-muted`     | `#9ca9a5` |
| Primary accent  | `--accent-primary` | `#b8e9cc` |
| Border          | `--border-default` | `#303a3c` |
| Error           | `--state-error`    | `#ffb2a8` |
| Success         | `--state-success`  | `#b8e9cc` |

## Typography

| Role      | Font              | Variable      |
| --------- | ----------------- | ------------- |
| UI text   | Segoe UI, system-ui, sans-serif | `--font-sans` |
| Code/mono | Consolas, monospace | `--font-mono` |

## Border Radius

| Context           | Class            |
| ----------------- | ---------------- |
| Inline / small UI | `--radius-small`: 6px |
| Cards / panels    | `--radius-panel`: 12px |
| Modals / overlays | `--radius-panel`: 12px |

## Component Library

React + Vite, strict TypeScript and plain CSS; no component or CSS framework dependency. The shell is in `src/renderer/main.tsx`; repository, documentation, chat, settings, notifications and source viewing use separate components.

## Layout Patterns

- Phase 2: workspace sidebar, local engine status/controls, encrypted OpenRouter key form, and an explicit note that repository indexing is not active yet. Status/errors use text; keyboard focus is visible. The window supports scrolling and a narrower desktop layout, with a 760px minimum width.
- Phase 3 replaces that setup-only state with `RepositoryPanel.tsx`: local/remote connection, optional branch, published commit, file coverage, progress, sync/cancel/retry/disconnect and an auto-sync toggle. `Notifications.tsx` adds the requested bell icon in the top nav bar, an unread badge and a separate right sidebar directly below the nav. It shows commit detection, completed updates and failures, persists read state, supports mark-all-read and Escape/close with focus return. Unchanged polls do not add notifications. Phase 4 adds documentation and Phase 5 adds cited chat.

- Provide repository selection, OpenRouter configuration, documentation browsing, cited chat, and source inspection. Use four sidebar views: Repository, Documentation, Chat and Settings.
- Keep the active repository and indexed commit visible; distinguish the currently queryable version from an in-progress background update.
- Show indexing/sync progress, file coverage, unsupported constructs, failures, and evidence gaps explicitly. Uncommitted changes are outside indexed coverage.
- Citations expose file and line references at the queried commit and open the corresponding captured source; never silently open newer working-tree content as evidence.
- Show resumable job failures and insufficient-evidence answers clearly. Background work must leave document browsing and chat responsive.

## Icons

No icon library in Phase 2; decorative marks are hidden from assistive technology. Future action icons must have accessible labels; indexing, error, and coverage states must remain understandable through text.

## Phase 4 documentation UI

`DocumentationPanel.tsx` contains manual generate/resume/stop, daily reported/unknown cost, coverage gaps and stale-commit warnings. `GenerationSettings.tsx` in Settings contains the shared model ID, request/token limits and optional automatic generation. A searchable page list opens module/function/workflow sections with inferred/uncertain labels. Citation buttons open numbered, captured source at the document commit. The layout stacks at narrower window widths. Completion/failure notices reuse the top-nav sidebar. The integrated sidebar provides navigation between views.

## Phase 5 chat UI

`ChatPanel.tsx` provides a bounded question composer, Ask/Stop/New conversation controls, retrieval/answering status and up to twenty session answers. It identifies direct extracted locations, inferred/uncertain model claims, cache hits, insufficient evidence, reported/unknown cost and old commits. Citation buttons open numbered captured source. Evidence details disclose retrieval gaps, expansion and documentation source candidates. Same-commit context includes up to three previous questions; changing commits starts fresh context. Model/token/daily settings are shared with documentation, whose controls are disabled during chat. Normal and narrow desktop layouts are verified; integrated navigation is implemented.

## Phase 6 integrated workspace

- The fixed shell keeps repository, branch, published commit, notification bell and Sync/Docs/Chat/daily-request status visible. Status buttons navigate to the relevant view. Repository next steps link to Settings, Documentation and Chat.
- Views remain mounted while hidden. Ordinary navigation preserves documentation search/selection, model drafts, chat drafts and per-view scroll position during the session. Repository/publication changes reset scoped content where needed; drafts are not persisted across restart.
- Settings combines encrypted-key controls, local engine controls and shared generation settings. Unsaved password input clears on leaving Settings.
- Documentation offers Ask about this file, which prefills and focuses Chat without sending a request. Empty/search/setup states identify the next action.
- Both citation types open `SourceViewer.tsx`, a native modal dialog with captured source, commit/line labels, optional line wrapping and an older-commit indicator. Escape/close returns focus to the originating citation. An open source dialog stays pinned during background publication.
- Normal and 780px desktop layouts were visually inspected; the 760px window minimum remains. Panels scroll beneath the fixed header/status strip without horizontal page overflow in the tested narrow flow.

## Model catalog configuration

Settings now has separate searchable chat/documentation and embedding lists, Refresh controls, model IDs, listed context limits and input/output token pricing. JSON-schema support is labelled from provider metadata. Refresh is explicit and failure retains the last list and selection. Users can still enter IDs manually. The embedding choice is saved, but the UI explicitly states that vector indexing is not active yet.

The requested workspace directory picker, full-section Chat and live React Flow Knowledge Graph tab are implemented as described below.

## Full-section Chat and live KG dashboard

Chat now occupies the entire working section below the shared header/status strip. A compact toolbar stays above a scrollable conversation; the composer stays below it. Enter sends, Shift+Enter inserts a line, Stop cancels and New conversation clears answers. Accepted submissions clear the composer; ordinary unsent drafts survive navigation. Messages distinguish the developer question from the cited answer, with commit/cache/cost/gap details preserved.

Repository has adjacent Repository and Knowledge Graph controls. The React Flow dashboard shows actual file/symbol/unresolved-call records with a three-column layout, pan/zoom/fit controls, minimap, displayed-node filtering, selection details, checkpoint progress and commit identity. It refreshes every three seconds while visible and on publication; switching out of Repository stops polling. A building preview is labelled separately from a published graph. Bounds and unsupported/unresolved relationships remain explicit.

## Workspace folder picker

Repository overview includes Choose workspace folder, the remembered path, Open workspace folder, connected-project/source/Markdown paths and Export published Markdown. Remote cloning requires a selected workspace. Existing local connections continue to work in legacy app storage until a workspace is chosen. Native picker cancellation does not change state. Choosing a new location for an existing connection copies its private mirror/source and exports already-published docs; old files remain. Changing folders waits for sync to finish/cancel and for documentation generation to stop.

## Answer confidence and data used

Every answer has a footer with Confidence N/100 (evidence estimate) and Document/Codebase/KG badges for retained evidence. Expand Score and source details for exact paths/lines and score reasons. Insufficient answers score zero; no evidence displays None. Cached answers retain their original score/provenance. The score is explicitly heuristic, not a correctness probability. Document and KG labels describe retrieval guidance; answers still cite captured source.

Documentation failures now appear in a bordered alert with recovery instructions, a Review generation settings action and expandable selectable Debug context (model, commit, output limit, completed pages and sanitized error). Truncation explicitly directs users to Output tokens per request.


## Chat without documents — 2026-10-11

Chat shows Document not found for this commit during retrieval and in an evidence trail beneath the answer. The trail distinguishes missing documents, no matches, direct lookup and matched documents, and shows retained code excerpts with KG guidance only when evidenced. The empty state explains that documentation is optional.


## Broad repository questions — 2026-10-12

Chat now invites questions about the entire codebase: purpose, setup, behavior, problems and improvements. Empty/insufficient states ask for a feature or observed behavior instead of requiring file/symbol names. Documentation stays paused.
