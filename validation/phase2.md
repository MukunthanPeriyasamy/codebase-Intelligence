# Phase 2 verification

Verified 2026-10-08 on Windows with Node 24.15, Electron 44.6.0 and Python 3.12.14. Exact frontend/build/test dependencies are locked in `package-lock.json`.

## Results

| Check | Observed result |
| --- | --- |
| `npm run build` | Strict TypeScript checks and renderer/main/preload/worker build passed |
| `npm test` | 13 tests passed, no skips/failures |
| `npm run test:desktop -- --max-failures=1` | 3 actual Electron tests passed, no skips/failures; final run 8.1 seconds |
| Visual inspection | Rendered foundation screen inspected; service ready, Python/SQLite status, key form and next-phase scope are readable |

Service tests cover strict action/protocol schemas, sender scope, credential save/replace/remove and encryption refusal, real Python/SQLite startup/restart, stop during restart, missing runtime, incompatible schema, startup/heartbeat timeouts, crashes, oversized/invalid messages and private request rejection.

Desktop tests cover launch and worker-ready UI; absence of Node globals and only six exposed bridge methods; invalid credential rejection; actual OS-encrypted fake-key persistence across application restart; worker stop/start controls; missing-runtime errors in the UI; and removal of an unreadable credential without blocking the worker. Screenshots are generated under ignored `test-results/`. These are functional boundary checks, not a comprehensive security audit.

## Windows crash and repair

The first desktop run terminated with breakpoint `0x80000003`. Electron logged `install_dir_access.cc:52`: sandboxed processes could not read the downloaded `node_modules/electron/dist` directory because its access entries did not permit `ALL APPLICATION PACKAGES`. A scoped read/execute grant (`S-1-15-2-1`, inherited by runtime files/subfolders) repaired startup. No application-data or credential-directory grant was made. The renderer sandbox remains enabled. The setup guide records the exact repair and when it applies. Final desktop verification ran in a host session with native app/OS encryption access.

## Scope and limits

- The worker implements transport, storage startup, heartbeat and shutdown. RepoWise analysis is still behind the Phase 1 design contract and has not been integrated with application indexing.
- Credentials are fake in tests. No OpenRouter request, model validation, paid call or answer-quality evaluation occurred.
- SQLite currently holds application metadata only. Repository snapshots, inventories, jobs and atomic publication arrive in Phase 3.
- Development Python comes from an explicit environment override or existing validation environment/PATH. No bundled runtime or installer exists yet; distribution is Phase 7.
- The dark React workspace is a provisional foundation design. Documentation, source browsing and chat are not implemented.
- Windows is the verified development environment. Cross-platform runtime paths, OS key stores and packaging remain to be validated for chosen targets.
