# Phase 4: behaviour and documentation

Implemented on 2026-10-09. The user chooses an OpenRouter model ID inside the app; generation is manual by default. Source synchronization remains automatic and commit-only. Optional automatic documentation generation is separately opt-in.

## Implemented

- Host-only OpenRouter chat-completions adapter, strict JSON-schema output, fixed HTTPS endpoint, no redirects, no automatic paid-call retries, a 60-second timeout and 128 KiB response limit. Unsupported structured-output models return an actionable error.
- Read-only Python evidence reader verifies snapshot identity and SHA-256 source hashes. It plans at most 2,000 pages, with module excerpts of at most 120 lines and one workflow page using up to six representative excerpts. Evidence input is limited to 16,000 bytes per request; this excludes the fixed system prompt/schema overhead.
- Module, function and workflow sections contain inferred/uncertain claims. Each claim requires a bounded citation with an exact source quote. Function sections must reference supplied symbols. Missing function sections, excluded files, omitted/redacted lines and bounded workflow coverage are reported.
- Common secret patterns and sensitive paths are filtered before requests. Private-key-containing files are withheld. Filtering is heuristic, not a guarantee that all sensitive business data or credentials can be detected.
- Defaults: five requests per run, twenty per UTC day, 2,000 output tokens per request, one request at a time. Settings allow 1–20/run, 1–200/day and 512–8,000 output tokens. These are request/token limits, not a dollar budget. Reported provider cost and unknown-cost attempts are distinct; users can cap spending on the provider key.
- Requests are reserved in a persistent ledger before sending. Interrupted requests may be billed and require explicit manual resume. Automatic mode does not retry existing jobs after failures/restarts. Completed pages are checkpointed and verified before atomic manifest publication.
- Jobs/cache keys include repository, commit, analyzer, model, output limit and prompt version. Every new commit conservatively invalidates derived documentation. Old published documentation remains browsable with a stale warning until replacement; old citations read the old captured source. No cross-commit model cache reuse is claimed.
- Desktop settings, generate/resume/stop, progress, coverage gaps, searchable page list, citation source viewer and persistent generation notices. Repository/model output is rendered as text, without HTML execution or external links.

## Verification

- `npm test`: 22 service/boundary tests passed, including real Git/snapshot/evidence integration, request-budget persistence and resume, secret exclusion, invalid citation rejection, stale-source viewing, source-hash tampering, cancellation, automatic opt-in and interrupted-request recovery.
- `npm run test:desktop -- --max-failures=1`: five actual Electron tests passed. The new flow covers in-app model settings, manual generation, bounded resume, source citation viewing and stale warnings after a new commit. Existing sandbox, credentials, worker and repository/notification tests still pass.
- `npm run build`: strict TypeScript and production bundling pass. Normal/narrow screenshots were inspected; a checkbox layout issue and stale phase labels were corrected. Screenshots are retained under ignored `test-results/`.
- Provider transport tests use a fixture response at the adapter boundary, checking the fixed endpoint, structured-output request and sanitized failures. Desktop tests replace the host fetch implementation in the test process; production has no mock mode or key bypass.

No live paid OpenRouter request was made. Real model availability, output quality, semantic citation support, costs and latency still need representative provider evaluation in Phase 7. Exact quote/span validation establishes reference integrity, not that the model's interpretation follows logically from the citation. Cross-platform packaging, complete execution graphs, cleanup and power-loss durability remain unvalidated.

Provider contract references: [OpenRouter API overview](https://openrouter.ai/docs/api_reference/overview) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
