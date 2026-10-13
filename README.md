# DeepWiki backend (current)

The Electron interface now uses an adapted, pinned DeepWiki pipeline with LanceDB
and RepoWise graph enrichment. Documentation generation remains paused.

On each computer, run from this project folder (Git and uv required):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-repowise.ps1
powershell -ExecutionPolicy Bypass -File scripts/setup-deepwiki.ps1 -ToolDirectory "D:\CodebaseIntelligenceTools\DeepWiki"
npm run dev
```

Choose a drive with sufficient free space. DeepWiki uses its own Python 3.12 runtime;
your app worker/system Python does not need to change. After restarting, save your
chat and embedding models, then select **Settings → Code search → Build / resume code
index**. This first rebuild is required even if the old index was ready. Later local
commit updates reuse unchanged embeddings. OpenRouter indexing remains manual.

Existing clones, documents and indexes are preserved. The UI is unchanged. See
[backend ownership, verification and limits](validation/deepwiki-pipeline.md).
Earlier setup instructions below are historical where they conflict with this section.

# Choose Ollama or OpenRouter

Both providers are supported. Restart the rebuilt app, open Settings and select **Model provider** under Generation settings.

- **Ollama:** start your local server, refresh installed models and select a local chat/code model.
- **OpenRouter:** save your API key in Connect OpenRouter, select OpenRouter, refresh the chat and embedding catalogs and choose model IDs.
- Click **Save generation settings**. Chat and documentation share the selected chat model. Model selections are remembered separately for each provider. Switching provider turns off automatic generation; enable it explicitly only if wanted.
- Output defaults to 8000 tokens. Requests/day and requests/run are shared across providers. OpenRouter incurs provider charges; saving settings and refreshing catalogs do not run inference.
- Code embeddings are supported for both providers through the DeepWiki/LanceDB backend described above.

Keys are OS-encrypted and never sent to Ollama. Existing documents, workspace data and Python 3.12/3.14 support are preserved. Earlier provider-exclusive descriptions below are historical.

# Python runtime compatibility

Python 3.14 is now supported alongside 3.12. Verified on Windows with CPython 3.14.2, RepoWise 0.55.0 and the existing pinned dependencies. Python 3.13 and 3.15+ are not enabled because they were not validated in this change.

For a separate Python 3.14 environment, run these commands in **PowerShell from the project root** (requires `uv`):

```powershell
./validation/setup_phase1.ps1 -Python 3.14 -Environment .research/venv314
$env:CODEBASE_INTELLIGENCE_PYTHON = (Resolve-Path .research/venv314/Scripts/python.exe).Path
npm run dev
```

The environment must include the pinned analysis dependencies, not just Python itself. The environment variable applies to this terminal session; set it again when launching from another session. Existing development `.research/venv` selection is unchanged. The setup script rejects reusing an environment with a different Python minor version.

# Local Ollama setup

OpenRouter has been replaced with local Ollama. Existing documents and workspace data are preserved; old provider settings are backed up and generation returns to manual setup.

1. Install [Ollama](https://ollama.com/download) and start it.
2. In a terminal run `ollama pull qwen2.5-coder:14b` (or `qwen2.5-coder:7b` for a smaller download/memory footprint).
3. Ollama must be listening at `http://127.0.0.1:11434`; use `ollama serve` if it is not already running.
4. Rebuild/restart the app with `npm run dev`. In Settings choose **Test Ollama connection**, then **Refresh chat models**, select the installed model and **Save generation settings**.
5. Generate a first page with one request per run and 8000 output tokens. The limit can be increased to 16384. Local inference allows ten minutes per request and uses a 32K context, which increases runtime memory needs.

Only local models are enabled. No key is required, no model is downloaded by the app, and no OpenRouter request is sent. Embedding model selection is available, but vector indexing is still pending. Older setup descriptions below are historical where they refer to OpenRouter credentials.

# Codebase Intelligence

Internal Electron workspace for commit-grounded repository documentation and cited chat. Phases 1–3 provide the desktop foundation, local/remote repository connection, immutable source snapshots, structural file coverage, commit-only background sync and persistent in-app notifications. Phase 4 adds manual OpenRouter documentation generation, configurable models/limits and source citation browsing. Phase 5 adds bounded repository retrieval, cited chat and verified exact-answer caching. Phase 6 integrates these into Repository, Documentation, Chat and Settings views.

## Development

Requires Node.js 22.12+ (validated with 24.15), npm, Git on PATH and Python **3.12 or 3.14**. Dependencies are pinned in `package-lock.json`.

```powershell
npm ci
node node_modules/electron/install.js
npm run build
npm start
```

`npm run dev` rebuilds and launches the same local assets and security policy as a normal launch; hot reload is not configured. Electron's first runtime download requires network access.

On Windows, a runtime downloaded inside a restricted automation environment may fail with breakpoint `0x80000003`. If Electron's log specifically reports `install_dir_access.cc` and missing `ALL APPLICATION PACKAGES` access, grant read/execute on the downloaded runtime only, from the project root:

```powershell
icacls "$PWD\node_modules\electron\dist" /grant '*S-1-15-2-1:(OI)(CI)(RX)'
```

This repaired the observed development launch failure. Keep the Electron renderer sandbox enabled. Do not apply the grant to application data or credentials; reinstalling dependencies may require repeating the runtime-only repair. Desktop automation must run in a host session that permits native app launch and OS encryption.

The development host uses `.research/venv/Scripts/python.exe` on Windows (or `.research/venv/bin/python` on Unix) if present, otherwise `python` on PATH. To choose another runtime:

```powershell
$env:CODEBASE_INTELLIGENCE_PYTHON = 'C:\path\to\python.exe'
npm start
```

The health worker uses the Python standard library. Snapshot indexing uses the installed RepoWise **0.55.0** parser when available; missing adapters/grammars and unsupported files have explicit coverage instead of a false structural-success claim. Use the pinned Phase 1 environment described in [validation/README.md](validation/README.md). Python bundling and an OS installer remain Phase 7 work; the build produces application assets, not a distributable installer.

## Connect and sync

1. Select **Choose workspace folder** in Repository before cloning. Then choose **Local repository** and select its root folder, or choose **Clone remote** and enter an HTTPS/SSH Git URL without embedded tokens. Remote clones use private bare mirrors in the chosen workspace; browsable committed source copies are exported beside them. Private repositories use existing Git credentials or an SSH agent/known host; interactive authentication prompts are disabled. Authenticate with your Git installation first.
2. Optionally enter a branch. Otherwise the app tracks the current local branch or the remote default branch, resolved once at connection time. Detached HEAD and empty repositories require a named branch with a commit.
3. Keep automatic sync enabled to check every **60 seconds** while the app is running. Local connections watch that local branch's commits; remote connections fetch that remote branch. The original checkout is never pulled, reset, staged or edited. Dirty/untracked files never enter snapshots.
4. Use **Sync now**, **Cancel sync**, **Retry sync** or **Disconnect** as needed. Cancellation pauses automatic checks; retry resumes verified per-file checkpoints. Closing the app stops its jobs. Enabled automatic checks resume at the next launch; no tray daemon is installed.
5. Open the **bell in the top navigation bar** for the right-hand notification sidebar. New commits, published updates and failures appear with timestamps and an unread count. Read state and the latest 100 notices persist. Unchanged checks are quiet.

A completed snapshot shows its exact commit, coverage and add/modify/rename/delete counts. The old published version stays available during an update. A branch rewind without any new reachable commit is reported without silently replacing the active snapshot; reconnect explicitly to follow the earlier history.

Git HTTPS uses HTTP/1.1 with normal certificate verification. Transient connection failures get bounded retries and then a visible error; the app never disables TLS verification. Snapshot bounds are 100,000 entries, 2 MiB per captured file, 512 MiB eligible source and a 15-minute job timeout. Binary/non-UTF-8 files, symlinks, submodules, oversized files and dependency/generated directories remain in inventory with explicit exclusions. Unsupported UTF-8 source is retained. Old snapshots and interrupted staging data are retained; cleanup is not implemented yet.

Incremental indexing reuses unchanged, hash-verified file records. Renamed/deleted source cannot retain stale symbol identities. Dependency invalidation is deliberately conservative: all derived file records are marked affected when content changes, including transitive dependents. Documentation is conservatively regenerated for each new commit; full relationship resolution remains later work.

## Verification

```powershell
npm test
npm run test:desktop
```

Tests use the same Python override, defaulting to the existing Windows validation interpreter. Service tests cover message boundaries, missing/crashed/unresponsive workers, SQLite schema rejection, credentials and lifecycle. Playwright launches actual Electron windows, checks renderer isolation, worker controls, OS-encrypted credential persistence and recovery. Test credentials are fake and never sent externally. Test data/screenshots stay under ignored `.local/tests/` and `test-results/`.

Phase 3 tests use owned Git fixtures for clone/update/rename/delete, dirty-source exclusion, automatic checks, snapshot reuse, interrupted recovery, publication recovery, process-tree cancellation and notification persistence. Desktop tests exercise native-folder connection and the notification sidebar. The optional public-network smoke test is `npx tsx validation/phase3-remote.ts`; it prints its isolated data directory, which can be supplied as a positional argument to resume after a network failure.

## Boundaries and storage

- `src/main/`: worker/Git/snapshot orchestration, atomic publication, notifications, app protocol, validated IPC and credential storage.
- `src/preload/`: narrow typed operations/events; no general IPC, command runner or arbitrary file access.
- `src/renderer/`: React UI and CSS tokens; no direct Node or network access.
- `src/shared/`: strict TypeScript/Zod contracts.
- `worker/service.py`: versioned, bounded JSON-lines transport, Python version check, SQLite startup, heartbeat and shutdown.
- `worker/snapshot.py`: Git-object inventory, hash-named source capture, RepoWise parsing, per-file checkpoints and validated SQLite snapshot indexes.
- `scripts/`, `tests/`: builds and service/desktop verification.

Normal data lives in Electron's OS user-data directory: `knowledge/metadata.sqlite3` and `credentials/openrouter.enc`. Development/tests can set `CODEBASE_INTELLIGENCE_DATA_DIR` to a separate directory. Credential input exists transiently in the password field, is cleared on submission and is never returned by the host. Electron `safeStorage` encrypts it; unavailable encryption and Linux `basic_text` are refused. Provider validity is checked on generation, not when saving the key.

Repository settings and notifications live in `knowledge/repository-state.json`; mirrors, staging and immutable snapshots live in `knowledge/repositories/<id>/`. Each snapshot has `index.sqlite3` and hash-named source blobs. The atomically replaced per-repository `active.json` pointer is authoritative even when a crash leaves the settings file stale. Repository-relative paths are only database keys, preventing path traversal and Windows filename collisions during source capture.

Only allowlisted bundled assets load through `codebase://app`, with a restrictive Content Security Policy. Main-frame sender checks, validated inputs/outputs, sandboxing, context isolation and denied permissions/navigation/new windows keep privileged operations outside React. The worker receives a minimal environment without inherited provider keys. Raw worker output is not forwarded into logs or the renderer. App exit and Stop shut down the worker with a forced-stop fallback; startup and heartbeat deadlines expose failures.

See [build phases](context/build-phases.md), [architecture](context/architecture.md) and [progress](context/progress-tracker.md). Security implementation follows Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [safeStorage contract](https://www.electronjs.org/docs/latest/api/safe-storage).

## Generate documentation (Phase 4)

After syncing a repository, save your OpenRouter key and enter a model ID that supports structured outputs in **Settings**. Save the model and request/token limits, open **Documentation**, then select **Generate / resume documentation**. Generation is manual by default; source sync stays automatic. Each click allows another bounded run, subject to the persistent UTC daily request limit. Stop preserves checkpoints. Interrupted requests may have been billed; resume explicitly to retry.

The defaults are 5 requests/run, 20/day and 2,000 output tokens/request, with one request at a time. These are not dollar caps: configure a spending limit on your OpenRouter key. The UI separates reported cost from unknown-cost attempts. Bounded source excerpts are sent externally; heuristic secret filtering cannot guarantee detection of every sensitive value.

Browse pages and click file/line citations to read the captured source. Claims are inferred/uncertain; exact quotes verify reference integrity, not semantic correctness. Coverage gaps and incomplete work remain visible. New commits mark old docs stale while keeping their original citations available. Automatic documentation for future commits is a separate opt-in setting.

Documentation settings, ledger, checkpoints, pages and published manifests live under `knowledge/documentation/`. No key is stored there. Tests use fixture providers and make no paid calls. See [Phase 4 verification and limits](validation/phase4.md).

## Ask repository questions (Phase 5)

Open **Chat** after a source snapshot is ready. For example, ask `Where is myFunction defined?` for a free structural lookup, or ask how a named file/function works for a cited model explanation. Explanations use the saved OpenRouter model and the same daily request budget as documentation. Each question permits at most two model requests (also constrained by the per-run limit), one local retrieval expansion and a three-minute deadline. Stop cancels the operation; an interrupted provider call may still be billed.

Chat pauses documentation generation to prioritize interaction. Resume documentation explicitly afterward. Exact lookups and verified answer-cache hits need no paid request. Use **New conversation** to clear the session and context. Up to three prior questions from the same commit inform follow-ups; old model answers are not passed as evidence. The session retains twenty answers and starts fresh after app restart, while exact cache files persist.

Every answer shows its commit, mode and evidence limitations. Click a file/line citation to inspect that captured source. Existing answers remain labelled as older after new commits; new queries retrieve from the current snapshot. Unsupported source remains eligible for bounded lexical retrieval. Call relationships are unresolved candidates, not a proven complete graph. Insufficient evidence produces a gap instead of an invented answer.

Persistent caches live under `knowledge/chat/`; their keys include snapshot, question/context, model/policy and documentation publication. Cache hits reverify source hashes and citations. There is no semantic cache or embedding dependency. See [Phase 5 verification and limits](validation/phase5.md). Live provider answer quality, latency and cost still require Phase 7 evaluation; automated tests use fixture providers without paid requests.

## Integrated workspace (Phase 6)

Use the sidebar to switch between Repository, Documentation, Chat and Settings. The header keeps the repository/branch/commit visible; the status strip links to sync, documentation, chat and daily request usage. Settings contains the local engine, OpenRouter key and shared model limits.

Documentation **Ask about this file** prefills Chat; submit it explicitly to ask. Citations open a shared read-only source dialog with commit/line labels and optional wrapping. Escape closes it and restores focus. Background updates retain opened source and old answers at their original commit. Ordinary drafts, document selection and scroll positions survive navigation during the session; unsaved password input clears on leaving Settings.

See [Phase 6 verification](validation/phase6.md). Live model quality and packaged runtime distribution remain Phase 7 work.

## Model lists

In Settings, use **Refresh chat models** or **Refresh embedding models**, search by model/provider and select an entry. Listed context limits, token pricing and JSON-schema support help compare entries; endpoint availability can still vary. Manual model IDs remain supported. Save generation settings to persist both choices. The embedding choice is configuration only until the vector pipeline is implemented; no embedding request is sent by saving it.

## Chat and live knowledge graph

Chat fills its workspace section with a scrollable conversation and a bottom composer. Enter sends; Shift+Enter adds a line. Source citations, Stop, New conversation, model settings and commit labels remain available.

Inside Repository, choose **Knowledge Graph** beside **Repository**. The React Flow canvas shows captured files, extracted symbols and unresolved call targets; use pan/zoom, Fit view, the minimap, filter and node details to explore. A visible dashboard refreshes every three seconds as checkpoints are saved, then switches to the published commit. Graph previews never become chat evidence. Display limits (60 files, 240 nodes, 400 relationships) and gaps are labelled.

## Workspace folder and Markdown files

In Repository, choose a workspace folder. The app remembers it and creates a uniquely named project folder for each connection. Open workspace folder opens the connected project (or the selected parent before connection). Cancelling the picker leaves the current selection unchanged. Choosing a different location with an existing connection copies its mirror/current source and exports published documentation; it does not move or delete the earlier project.

```text
chosen-workspace/
  repo-name-unique-id/
    repository/<commit>-<unique-id>/   # Browsable Git clone at that commit
    docs/README.md                    # Link to latest generation
    docs/versions/<commit>-<id>/
      README.md
      modules/*.md
      functions/*.md
      workflows/*.md
    notes/                            # Your personal notes
    .codebase-intelligence/mirror.git/
```

After each bounded documentation run publishes validated pages, Markdown is exported automatically. Incomplete generations list their remaining/omitted work. Export published Markdown retries export without model calls. Old source/document versions and personal notes are retained. Edit personal notes under notes/; docs/README.md is an app-managed entry point. Version retention increases disk usage; automatic cleanup is not implemented.

Analysis snapshots, internal generated-page checkpoints, caches, budgets and encrypted keys remain in Electron app data. Browsable source copies do not affect indexing if edited. Generation remains manual by default; folder selection/export does not make provider calls. Vector indexing is not yet implemented.

Each chat response includes an evidence-confidence score and Data used badges (Document, Codebase, KG). Expand the footer for score reasons and file/line details. This heuristic is not a probability of correctness. Document/KG badges indicate how retained source excerpts were retrieved; generated document claims and graph previews are not authoritative answer evidence.
