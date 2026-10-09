# Workspace picker and Markdown export

Implemented 2026-10-09. Repository now offers a native Choose workspace folder picker, persistent selected path, Open workspace folder and Export published Markdown. Cancelling selection leaves state unchanged. Remote cloning requires a workspace; existing local connections keep working until one is selected.

Each connection creates an exclusive `repo-<name>-<suffix>/` project beneath the selected parent. Its private mirror is under `.codebase-intelligence/mirror.git`; browsable detached clones are retained under `repository/<commit>-<uuid>/`. Clone staging is on the destination volume and Git long-path support is enabled. Changing workspaces copies the existing mirror/current source; previous exports and originals are not deleted or modified.

Validated generated pages automatically export as `.md` files under `docs/versions/<commit-prefix>-<uuid>/modules`, `functions` and `workflows`. A generation README links pages and records commit, remaining work and omissions. `docs/README.md` is published last and links the latest generation. Manual export retries need no provider call. `notes/` is reserved for personal files and never touched during generation.

Authoritative analysis snapshots, generation checkpoints, caches, budget ledger and encrypted keys remain in app data. Exported source edits do not enter indexing. Vector indexing is not implemented by this feature. Versioned copies consume additional disk space; retention cleanup remains pending.

## Verification

- Build/typecheck passed. `npm run test:desktop -- --max-failures=1`: 10/10 actual Electron scenarios passed together in 2.3 minutes.
- `npm test`: 30/30 service and boundary tests passed, including remembered workspace, real clone/source exports, new commit versions, folder switching, old-copy preservation, Markdown structure, function pages, personal notes and IPC path rejection.
- Electron documentation flow verifies picker selection, source publication, actual Markdown index output and continued stale-citation behavior.
- Native picker/open-folder calls are intercepted inside the Electron test process to select isolated test folders and avoid opening Explorer during tests. UI dispatch, cancellation and restart persistence are exercised; no production test bypass exists.
- Visually inspected `test-results/workspace-picker.png`.
- No paid model calls were made; provider responses are fixtures. Physical cross-volume storage was not exercised; same-volume clone staging removes the prior cross-volume rename dependency.
