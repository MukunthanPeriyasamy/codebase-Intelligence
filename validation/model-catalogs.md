# OpenRouter model configuration

Implemented 2026-10-09: separate searchable chat/documentation and embedding catalogs, explicit refresh, manual IDs, listed context/pricing/schema capability and persistent embedding choice. Previous ledgers remain readable. Catalog errors preserve selections. Embedding execution and vector storage are not yet implemented.

Verification: build/typecheck passed; 27 service tests passed; three foundation Electron tests passed; the targeted model catalog Electron scenario passed after correcting the select label association. The scenario covers search, selection, save, zero inference requests, failed refresh and restart persistence. Screenshot `test-results/model-settings.png` was inspected. Tests use fixtures. Official public catalog endpoints were inspected through browsing; direct Node live fetch failed in the restricted environment, so live host connectivity is not claimed.

## Planned re-embedding lifecycle

1. Capture the new committed source and identify changed/deleted and conservatively affected documentation.
2. Regenerate affected documentation when the user invokes generation, or under the existing opt-in automatic generation setting.
3. Split validated documents into stable sections/chunks and compute hashes of the exact embedding input. Keep source citations and repository/commit metadata separate from reusable vector content.
4. Reuse matching cached vectors only within the same repository, embedding model, dimensions and preprocessing/chunk policy. Send new/changed inputs to OpenRouter in bounded batches; checkpoint successes and account for paid attempts.
5. Stage replacement vectors and omit deleted chunks from the new index. Rename-only metadata changes can reuse vectors only when embedding input is unchanged. Never expose staging data to queries.
6. Validate finite vectors, dimensions, document/source references and completeness, then atomically publish the document/vector manifest. Failed work leaves the previous version intact, visibly stale if the source commit advanced.
7. Embed each question with the published index model and dimensions; search vectors first. Advance to KG and then code only if evidence is insufficient. Similarity is not an answer-confidence probability; source citations still require verification.

Changing the embedding model or dimensions requires rebuilding the entire vector collection. Changing chunk/preprocessing policy requires re-chunking and invalidates incompatible embeddings. Keeping model identity/version in the index avoids mixing vector spaces. OpenRouter returns vectors; the application stores and queries them locally.

References: https://openrouter.ai/docs/api/api-reference/embeddings/list-all-embeddings-models and https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
