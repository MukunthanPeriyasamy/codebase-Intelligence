# Phase 3 verification

Verified on Windows, 2026-10-08, using Git 2.52, Node 24.15, Electron 44.6.0, Python 3.12.14 and the installed RepoWise 0.55.0 adapter. Dependency versions remain pinned in the existing locks/environment records.

## Results

| Check | Observed result |
| --- | --- |
| `npm test` | 18 passed; no skips or failures; final run 40.4 seconds |
| `npm run test:desktop -- --max-failures=1` | Typecheck/build passed and all 4 real Electron tests passed; final desktop run 17.8 seconds |
| `npx tsx validation/phase3-remote.ts <existing-smoke-directory>` | Resumed the real public remote connection, fetched its tracked branch and published a validated snapshot |
| Visual inspection | Inspected the repository workspace and top-nav bell/right notification sidebar at normal and narrow desktop widths |

The public source was `https://github.com/sindresorhus/p-limit.git`, default branch `main`, commit `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`. The published inventory had **16 files: 6 parsed, 5 document-only, 5 unsupported, 0 excluded, 0 failed**, using `snapshot-v1/repowise-0.55.0`. This is a development source snapshot, not a documentation/answer-quality result. No OpenRouter calls were made.

## Behavior exercised

- Real local Git clone into a private bare mirror, current-branch selection and exact committed-object capture.
- Dirty and untracked source excluded; original checkout status unchanged by syncing.
- Add/edit/rename/delete in one commit: one of each change detected, two unchanged records reused, new-path symbol IDs present and removed/old-path records absent.
- Published commit remains the old version while an update runs; previous source artifacts remain byte-for-byte unchanged after publication.
- Same-commit polling produces no replacement snapshot or new notification.
- Timer-driven detection without a manual sync request; cancellation pauses automatic checks.
- Per-file checkpoint resume after interruption; all 45 fixture files recovered with verified record reuse.
- Git-index symlink object inventoried as excluded without following its target.
- Crash-point simulation: deliberately stale settings after publication are corrected from the authoritative active pointer on restart.
- Backward branch movement without new reachable commits reports a failure and preserves the newer published snapshot.
- Notification persistence, read-state persistence, mark-all-read, Escape/close focus behavior and in-app update display.
- Owned process-tree cancellation, including a helper subprocess, so Git network helpers do not survive normal cancellation.
- Existing worker, storage, credential and renderer-boundary regressions remain passing.

The Electron repository test drives native folder selection via a controlled dialog fixture, waits for the first snapshot, creates a new fixture commit, leaves an uncommitted edit, requests sync, verifies the displayed commit/update notices and operates the auto-sync checkbox. Screenshots are generated at `test-results/repository-notifications.png` and `test-results/repository-narrow.png` (ignored artifacts).

## Fixes discovered during verification

- Windows long-path failures in deeply nested hash-named source storage: source artifact filesystem operations now use the extended Windows path form; repository paths remain SQLite keys.
- Publication/settings ordering: `active.json` is now the independent atomic publication authority, recovered even when settings are stale.
- Controlled checkbox lag during async persistence: immediate visual state with rollback after a failed action.
- Intermittent HTTPS Git transport failures on this machine: HTTP/1.1 and bounded retries improve compatibility; failures remain explicit. The initial public clone completed, a subsequent fetch failed, and resuming the persisted connection completed indexing/publication. TLS verification was never disabled. Both OpenSSL and the separately tested Windows TLS backend experienced transient errors, so the app does not claim to fix all network conditions or switch TLS backends.

## Limits

- One connected repository; local root selection or HTTPS/SSH clone into app-owned storage. Private authentication and SSH servers were not exercised with live credentials; they use the existing noninteractive Git environment.
- Selected branch checks every 60 seconds while running; no tray daemon. The test uses a shorter timer to exercise scheduling without a minute-long wait.
- File-level structural reuse is incremental. Dependency invalidation is conservative across all derived file records, not a claim of precise complete cross-language dependency resolution. Call-site records are explicitly unresolved.
- Inventory coverage is explicit. Limits are 100,000 entries, 2 MiB per captured file, 512 MiB eligible source and 15 minutes per snapshot job. Unsupported text remains captured; excluded binary/non-UTF-8/oversized/dependency/generated files, symlinks and submodules do not become parsed source.
- Snapshot publication is process-crash recoverable through atomic file replacement. This is not a power-loss durability certification or exhaustive disk-corruption test.
- Old snapshots and failed staging/clone data are retained; disk cleanup/retention tuning remains future work.
- No documentation generation, model verification, complete graph retrieval, cited chat, packaged Python runtime or installer is included. These remain in their planned phases.
