# Phase 1: Backend Validation and Baseline

**Status: complete as a technical feasibility and integration-decision phase (2026-10-07).** Phase 2 can start. This is not a completed desktop app or an end-to-end answer-quality certification.

## Integration decision

Use unmodified **RepoWise 0.55.0**, commit `7f84ae07908de40595fc64b3fe3c910123367a1e`, behind a **Python 3.12 worker adapter**. Reuse structural analysis, persisted graphs, SQLite metadata and lexical search. The application owns immutable snapshots, job state, evidence validation, cache scope and atomic publication. Add bounded source/path retrieval for gaps in symbol/document search. Do not add a second graph database or independent semantic service during scaffolding.

The guards in `adapter-contract.md` are required. Direct CLI integration against a mutable user checkout would violate commit-only indexing. The backend does not provide uniform structural understanding of every language.

## Executed evidence

| Probe | Result | Artifact |
| --- | --- | --- |
| Initial synthetic symbols, spans, calls and Git diffs | 24/24 passed across seven languages | repowise-baseline-results.json |
| Full release-archive indexing and persisted retrieval | Both repositories indexed successfully | phase1-evaluation-results.json |
| 50 source-grounded retrieval questions | 40/45 expected files in upstream top 10; 5/5 absent-symbol queries empty; no tool errors | phase1_questions.py, phase1-evaluation-results.json |
| Bounded source/path fallback | Combined candidates found expected files in 45/45 positive cases; 5/5 negatives remained empty | phase1-supplement-results.json |
| Language availability and upstream fixture parsing | 26 grammar tags loaded; 61 files across 15 tags examined, 56 with symbols | phase1-supplement-results.json |
| Persistence, updates, dependent invalidation, cache and completed-run resume | 21/21 checks passed | phase1-lifecycle-results.json |
| Abrupt termination after symbol persistence, then resume | Same symbol/page/edge counts as uninterrupted run; no duplicate symbols; SQLite integrity OK | phase1-recovery-results.json |

### Real repositories

| Repository | Pinned commit | Symbols | Pages | Graph nodes / edges | Inventory |
| --- | --- | ---: | ---: | ---: | --- |
| pallets/itsdangerous 2.2.0 | `096c8d42545d3b68ea21a4f890fb2b2d8979c0bd` | 158 | 27 | 239 / 557 | 60 files: 16 parsed, 14 document-only, 30 excluded |
| sindresorhus/p-limit 6.2.0 | `7d14b3f04aa990f621a853e24e2a4b796baf1ec9` | 7 | 8 | 31 / 34 | 13 files: 4 parsed, 4 document-only, 5 excluded |

Every archive file has an inventory status and hash, including upstream traversal exclusions. All persisted symbol spans resolve inside source files. The Python graph contains 81 cross-file call edges with provenance; this is not a precision/recall score. Examples include Serializer.__init__ calling _make_keys_list in signer.py and want_bytes in encoding.py.

Archives retain source and licenses but have no upstream Git history. Commit/update behavior is tested separately in owned synthetic repositories. Fixture code is read, never executed.

### Measurement limits

The 50 seed questions cover symbols, branch/error conditions, side effects, workflows, tests, configuration, a documentation concept query and absent symbols. Positive cases include expected facts and anchors reviewed against source by the coding agent. **Human developer review remains pending** for the final evaluation gate.

Search queries/modes are supplied by the evaluator: this is retrieval-plan evaluation, not automatic natural-language routing. A file hit does not prove answer correctness. Returned symbol spans cover the anchor in 39 cases. Source fallback returns candidate locations, not complete evidence packets. Misses remain recorded.

Latest sequential local retrieval p50/p95: **259.24 / 401.2 ms**, including per-call adapter setup. These are observations, not product targets or controlled cold/warm measurements. Large-repository scale, peak memory and cost per correct answer remain integrated-app measurements.

All probes made **zero paid model calls**. Documentation used `--no-prose`; mock embeddings were only a keyless test dependency. Semantic embedding quality and generated answers were not evaluated.

## Findings and mitigation

1. **Working-tree contamination:** the pinned commit-diff helper can parse new content from the mutable checkout. Reproduced with an uncommitted-only symbol. Read Git blobs and run filesystem-dependent analysis on isolated committed snapshots.
2. **Language coverage:** Haskell returned no symbols and no errors. Installed-package/query checks alone reported no gaps, yet actual COBOL grammar loading failed because its language-pack cache could not be created in this environment. Report unavailable grammars explicitly; use an application-owned grammar cache or source fallback. Loaded grammar counts do not certify semantic accuracy. The 15 fixture tags include passthrough Lean.
3. **Nested JavaScript:** symbol retrieval missed clearQueue, resumeNext and next in p-limit. The fixed, gold-independent source-search rule recovered the expected file.
4. **Configuration:** upstream path search did not return package.json for two questions. Maintain a full inventory and direct source/path retrieval independently of selected documentation pages.
5. **Deletion semantics:** symbols and edges were removed for deleted/renamed files. Historical docs became tombstones; symbol/concept retrieval excluded obsolete targets. Preserve that filtering and snapshot-scoped caches rather than requiring physical deletion of history.
6. **Incrementality:** upstream reuses content-hash parsing but rebuilds graph structure. Cache hit/miss and dependent-caller invalidation passed. Application-level behavioural invalidation and publication still require implementation.
7. **CLI side effects:** disable editor setup, hooks and key saving. Validation used `--no-editor-setup --no-agents --no-codex --no-hook --no-save-key`. Production uses the narrow adapter, not default setup behavior.

## Phase ownership

The earlier working checklist mixed feasibility with future implementation. These explicit later-phase gates are not being claimed as completed:

- Phase 2: Electron bridge, worker startup/distribution, protected credentials and surfaced failures.
- Phase 3: production monitoring, committed snapshot isolation, complete inventory, job cancellation/checkpoints and atomic publication under concurrent queries. One interrupted-run recovery is feasibility evidence, not all-crash-points certification.
- Phases 4–5: OpenRouter model settings and real generation, claim support, semantic search if selected, answer-cache invalidation and routing evaluation.
- Phase 7: human question review, additional held-out/framework-heavy repositories, cold/warm timings, memory, packaging and cost per correct answer.

SQLite and immutable local files are the selected initial storage boundary. The full upstream package also installs LanceDB; no separate semantic service is justified by this baseline. Never present mock vectors as semantic search.

## Reproduction

Source commits and downloaded archive hashes are in `phase1-pins.json`. Hashes describe downloaded artifacts, not third-party attestations. Upstream declares AGPL-3.0-or-later; retain its license/notices.

From the project root with uv and Python 3.12:

```powershell
./validation/setup_phase1.ps1 -Python '3.12'
$env:PYTHONIOENCODING = 'utf-8'
$env:DO_NOT_TRACK = '1'
$env:REPOWISE_SKIP_EDITOR_SETUP = '1'
$env:REPOWISE_NO_SAVE_KEY = '1'
& .research/venv/Scripts/python.exe validation/repowise-baseline.py
foreach ($name in @('itsdangerous', 'p-limit')) {
    $pin = Get-Content ('.research/' + $name + '-pin.json') -Raw | ConvertFrom-Json
    $snapshot = '.research/' + $name + '-' + $pin.commit
    & .research/venv/Scripts/repowise.exe init $snapshot --no-prose --provider mock --embedder mock --yes --no-editor-setup --no-agents --no-codex --no-hook --no-save-key --no-workspace
    if ($LASTEXITCODE -ne 0) { throw "Indexing failed: $name" }
}
& .research/venv/Scripts/python.exe validation/phase1_evaluation.py
& .research/venv/Scripts/python.exe validation/phase1_supplement.py
& .research/venv/Scripts/python.exe validation/phase1_lifecycle.py
& .research/venv/Scripts/python.exe validation/phase1_recovery.py
```

Check each command's exit status; the JSON reports retain misses and limits. Sources, logs, runtime and generated fixtures are ignored under `.research/`. `phase1-requirements.txt` freezes the full tested environment; `baseline-requirements.txt` retains the earlier minimal environment. The setup script passed syntax validation; its download/install operations were executed individually, not as a fresh-machine bootstrap run.

This machine's working Python is `C:\Users\MUKUNTHAN\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`; its WindowsApps alias fails. Do not ship that machine-specific path. No npm build exists before Phase 2 scaffolding.

