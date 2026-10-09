# Selected Analysis Adapter Contract

Phase 1 design decision, supported by executable probes. Phase 2 implements health/shutdown transport and SQLite initialization in `worker/service.py`. Phase 3 implements Git-object inventory, bounded source capture, structural file records, checkpoint/resume, changes/invalidation and host-owned atomic publication through `worker/snapshot.py` and the Electron repository service. Full graph retrieval, model evidence and cited answers remain later phases.

## Process boundary

Electron main launches a pinned Python 3.12 worker. Use versioned JSON over a private process channel, initially stdin/stdout; logs use stderr. The renderer receives validated application messages through preload and cannot directly access backend APIs or credentials. Long-running operations carry a job ID, progress and cancellation states. Bound concurrency and response sizes.

## Identity and inputs

- Application-owned repo_id, verified immutable commit_sha and snapshot_id incorporating analyzer/schema/config versions. Incomplete builds have distinct IDs.
- Resolve and verify refs before comparing commits. Invalid refs or a repository without a commit are explicit errors; upstream's empty-diff fallback is not evidence that a ref is valid.
- Materialize a private committed snapshot with path validation and explicit symlink/submodule handling. Never pass a mutable user checkout to filesystem-dependent analysis.
- Enforce file, token, graph-hop, job and concurrency limits in application code. Pin both RepoWise source commit and adapter version.

## Operations

| Operation | Required contract |
| --- | --- |
| Inventory | Enumerate every committed file independently of parser exclusions; report hash, size, language, status and reason. |
| Analyze | Return symbols/spans/hashes, typed relationships with provenance/confidence, and unsupported or unresolved boundaries. |
| Plan refresh | Return changed and affected records across exact commits, including additions, edits, renames and deletions. |
| Build index | Persist staged structural/source/document indexes with version, coverage, job state and validation results. |
| Retrieve | Bounded exact-symbol, lexical-source/path, documentation and graph candidates, each scoped to the snapshot. Exclude current-version tombstones. |
| Read source | Resolve citations against exact captured source and matching hashes; never substitute working-tree bytes. |

No operation edits or runs the analyzed repository. The host chooses which complete version becomes active, not the analysis worker.

Phase 3 captures each source file under its SHA-256 hash; its original path is a SQLite key. It records validated symbol spans and unresolved call sites, without claiming a complete resolved graph. Actual grammar loading and empty/error extraction determine coverage. Reuse requires matching path/object/mode/analyzer and a verified stored hash. Renames are reparsed under their new path. Conservative invalidation marks every derived file record on a commit change so unknown transitive dependencies cannot be silently reused.

## Coverage and evidence

Distinguish parsed, document-only, excluded, unsupported and failed. Record actual grammar loading and partial/special-handler extraction. Nonempty symbols do not certify complete graphs. Unsupported text remains eligible for source retrieval and later model-assisted explanations with explicit uncertainty.

Every evidence item carries repo_id, commit_sha, snapshot_id, optional symbol_id, path, line span, source hash and analyzer version. Derived records add dependency fingerprints; model-assisted claims add model/prompt versions and extracted/inferred/test-supported/unresolved basis.

## Publication and invalidation

Preserve the prior complete snapshot during a new build. Validate required jobs/citations before atomically switching the active pointer. Cancelled/failed builds remain unpublished. Cache unchanged parses by content/config version; invalidate changed/deleted/renamed and affected derived records. Scope retrieval and exact-answer caches to the published snapshot; TTL or semantic similarity is not sufficient for reuse.

Use local SQLite metadata and immutable files initially, with upstream persistence behind the adapter. Do not add another graph/vector service without measured need. Machine-local sealed caches are not portable trusted artifacts. Mock semantic vectors are forbidden in production.

## Errors and later acceptance gates

Return structured errors for invalid repository/ref, unavailable grammar, unsupported content, parsing failure, exhausted budget, cancelled job, incompatible/corrupt cache, provider failure and citation/hash mismatch. Partial coverage must not be labelled complete.

Phase 1 establishes persisted retrieval, source fallback, clean commit updates, dependent invalidation, tombstone filtering, parse-cache reuse and one interrupted-run recovery. Phases 2–5 must exercise the actual app boundary, concurrent queries during publication, transitive invalidation, dirty-worktree exclusion, multiple crash points and model claim support.
