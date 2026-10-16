# Developer context and grounded answers

Interactive answers and edit proposals share a language-independent intent resolver.
It distinguishes visual theme, application purpose, UI state, database models,
inference models, API contracts, services and database schema. Follow-up referents
use recent user turns; previous assistant guesses are not retrieval evidence.
Explicit corrections take priority. This is an extensible heuristic vocabulary,
not exhaustive natural-language understanding. Ambiguous requests can produce a
validated clarification rather than an invented interpretation.

Retrieval first loads the matching generated documentation. Missing/empty caches
stop before embeddings, source reads or answer generation with the existing exact
message `No document Found Generate One`. The document schema records concept
paths and cited source ranges. Wiki generation prompts now explicitly cover
declarative configuration, styles, tokens and active usage across languages.
Refresh Wiki is required to enrich existing documentation; routing metadata is
rebuilt from existing cached documents automatically.

Document ranking combines BM25 with configured-provider embeddings and reciprocal
rank fusion, boosted by concept matches. The bounded candidate window contains up
to 128 lexical candidates and additional schema-prioritized document chunks up to
256 total. This is not exhaustive vector search across arbitrarily large wikis.
Cosine scores below 0.4 do not contribute semantic matches; this starting threshold
requires calibration per embedding model. Up to six chunks, two per primary file,
are supplied. Embeddings are batched in groups of 16 and cached in memory by model,
endpoint and content hash (4096 entries); a server restart clears that cache.
Provider failure logs degraded BM25 mode and never enables raw-code fallback.

Only paths referenced by selected documents are read. Answer prompts receive up to
180 relevant current lines per file, preserving line numbers. Edit proposals retain
complete admitted source snapshots for exact range validation and conflict checks.
Accept remains the only write operation; reject leaves files unchanged.

Answers are buffered until checks finish, so first visible text arrives later than
ordinary streaming. Citation checks reject nonexistent files, out-of-range lines
and lines omitted from the prompt. A second model pass checks relevance and
grounding. Ollama gets one bounded corrective attempt; paid providers do not retry.
Unverified output is replaced with an evidence-insufficiency message. Clarifications
and evidence-only abstentions can pass without fabricated citations. Model-based
verification reduces errors but is not a proof of semantic correctness.

Diagnostics log concept, retrieval mode, selected chunk IDs/scores and validation
failures, without dumping source or model answers. Existing proposal validation and
acceptance conflict checks remain in force.

## Verification

147 backend regression tests passed in the selected suite. The existing deprecated
Google SDK emits a warning; it did not fail the run.

Regression fixtures cover the colour clarification, British/American spelling,
purpose vs theme, developer concepts, language-independent declarative documents,
semantic-only candidates, embedding cache/failure, omitted-source citations,
irrelevant-answer retry, clarification, missing documents and approval boundaries.
Run with:

```powershell
$env:TIKTOKEN_CACHE_DIR = "$PWD/.local/deepwiki-tool/token-cache"
.local/deepwiki-tool/runtime/Scripts/python.exe -m pytest tests/backend tests/test_developer_context.py tests/test_document_first.py tests/test_document_schema.py tests/test_change_review.py tests/test_local_ollama_pipeline.py tests/test_config.py -q
```

Live Ollama validation was unavailable: localhost:11434 refused the connection and
no `ollama` executable was found on PATH. Fixture results do not establish live
Gemma accuracy or latency. Once available, replay the two screenshot questions and
the explicit "No, I mean its colour" correction against a refreshed wiki, checking
the actual cited colour value and active light/dark wiring. Compare retrieval
recall, correction success, citation validity, abstention and latency before
changing the model or retrieval thresholds.
