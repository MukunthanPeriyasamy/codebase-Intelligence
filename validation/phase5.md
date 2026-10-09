# Phase 5: retrieval and cited chat

Implemented and verified on 2026-10-09. The existing user-selected OpenRouter model and request/token settings are reused. Documentation remains manual by default; asking a question is an explicit interactive operation.

## Retrieval and answering

- `worker/retrieval.py` queries only a complete, commit-bound snapshot. It ranks exact parser symbols, paths and lexical source matches, including retained text without structural support. Unique definition-location queries return a local answer without a model or key. Ambiguous names do not use the direct path.
- Retrieval examines up to 10,000 captured file records and approximately 100,000 symbols (the current file's symbol list may cross the threshold). Source fallback reads up to 256 files / 8 MiB initially, or 2,000 files / 32 MiB after one expansion. Candidates contain at most 12 source ranges of 40 lines. Resource limits and incomplete coverage produce visible gaps; a missing match never certifies absence from the repository.
- Call/workflow queries expand recorded unresolved name-matched call sites for at most two hops / 24 edges. They select source around the relationships; the model must cite actual source. This is not complete import resolution, dynamic dispatch analysis or a proven execution graph.
- Current-commit documentation is ranked by title/path. Up to three pages contribute source evidence, re-read and hash-verified from the snapshot. Stale documentation never enters a new-commit answer. Derived claims are not treated as source truth.
- At most six source excerpts and 11,000 evidence bytes are packed; the entire question/history/evidence/gaps input remains under 16,000 bytes. Source redaction and secret-pattern checks are applied before model calls. The existing strict JSON, source quote/span, function-reference and hash checks protect answer/citation integrity.
- Questions may use at most three previous questions from the same repository and commit, within 3,500 bytes. Previous model answers are not supplied as evidence. A new commit starts a new retrieval context; earlier answers remain visibly pinned to their older commit. The current session retains twenty answers; conversation history is not restored after restart.
- At most one local expansion and two model requests are allowed per question, further constrained by the user's per-run and shared daily limits. Sparse retrieval expands before a request. A model reporting insufficient evidence can trigger the one expansion if unused; otherwise the app reports the gap. Transport errors and uncertain billed requests are never automatically retried. There is no automatic escalation to another model.
- Chat takes priority by stopping/checkpointing documentation and holding an exclusive interactive reservation. Resume documentation explicitly afterward. Questions have a three-minute deadline in addition to worker/provider deadlines and can be cancelled. Repository switches abort queries; a new commit within the same repository may finish an already-started question against its pinned old snapshot.

## Caches and storage

- A bounded 32-entry in-memory retrieval cache is separate from the persistent exact-answer cache under `knowledge/chat/<repoId>/<fingerprint>.json`.
- Exact keys include question, effective previous questions, full snapshot reference (including directory/analyzer), model, output limit, chat policy/prompt version and current documentation publication fingerprint. TTL and semantic similarity are not used for freshness.
- Cache hits revalidate schema, scope, source hashes, snippet text, blocked lines and citations before display. New commits, renames/deletions, different context/model settings and documentation publication changes cannot reuse incompatible results. Corrupt caches fail closed with an actionable error. Storage cleanup remains Phase 7 work.
- Local lookups/cache hits consume no provider request. Paid chat and documentation requests reserve the same persistent daily ledger before sending, with reported and unknown cost kept separate. Limits are request/token caps, not dollar caps.

## Executed checks

- `npm test`: **25/25** service/boundary tests passed. New tests cover shared-budget/priority/cancellation behavior, one-expansion/two-call limits, bridge input validation and real Git/snapshot/source integration.
- Real fixture queries exercise unique and ambiguous symbols, configuration source fallback, unresolved callers, documentation source retrieval, missing symbols, dirty-source exclusion, invalid model quotes, cache hits after service restart, context-sensitive misses, a query spanning new-commit publication, rename/removal invalidation, old citations and source tampering.
- `npm run test:desktop -- --max-failures=1`: **6/6** actual Electron tests passed, preserving foundation, credentials, repository sync, notifications and documentation flows. The chat test checks a free lookup with no saved key, a cited fixture-model answer, source viewing, free cache reuse, new-commit stale labels, missing-symbol gaps and narrow layout.
- Build/typecheck passed. Normal and narrow chat screenshots were inspected. A final targeted chat rerun covers the last deadline/fallback guard and screenshot changes. Screenshots are ignored under `test-results/`; its fixed header is hidden only during cropped chat screenshots so it does not obscure the captured heading.

No live paid provider request was made. These results verify retrieval, resource limits, transport integration and reference integrity, not semantic correctness of real model answers. Secret filtering remains heuristic. Embedding-based semantic retrieval, complete graph resolution, live quality/cost/latency evaluation and packaging remain unvalidated/deferred until measurements justify them. The developer-reviewed 50-question evaluation remains a Phase 7 gate.
