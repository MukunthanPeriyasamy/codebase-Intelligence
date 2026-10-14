# Full DeepWiki replacement — 2026-10-14

## Scope

The complete frontend and backend from AsyncFuncAI/deepwiki-open commit
`d92819a9c9f3b99416e3580ff235fc9d3adf8b89` replace the custom Electron application.
The upstream MIT license is retained. The old application is recoverable from
project commit `f8ac2ac`; existing user workspaces and external tool installations
were not deleted.

Active flow: native repository cloning/reading → line-tracked text chunks →
Ollama embeddings → native LocalDB persistence and FAISS retrieval → source context
and conversation history → native streamed model generation. The full wiki/chat,
diagram and research interfaces are imported. This is no longer the custom
DeepWiki component adapter, RepoWise MCP pipeline or LanceDB implementation.

## Local changes

- Ollama defaults for generation and embeddings; qwen3:8b appears first in the
  native model selector, with nomic-embed-text for embeddings.
- Model availability checks treat an omitted tag as `:latest`, while preserving
  explicitly different tags.
- Both Ollama SDK clients use a configurable 900-second read timeout and a
  10-second connection timeout.
- Storage defaults to `.local/deepwiki-data`, overridable with DEEPWIKI_DATA_DIR.
- Windows setup installs locked Python dependencies and npm dependencies;
  the launcher starts loopback API/UI servers and stops the API on exit.
- Aligned Next.js and ESLint dependencies and applied compatible audit patches.
- Fixed the advertised owner/repo shorthand in the upstream repository form.
- All seven context files now identify this migration as the current direction.

## Verification

- Production frontend build passes (Next.js 15.5.27); four upstream lint warnings
  remain concerning a font link and hook dependencies.
- 40 targeted Python tests pass on Python 3.12.14:
  `tests/test_local_ollama_pipeline.py`, `tests/test_config.py`,
  `tests/test_extract_repo_name.py`, and `tests/unit/test_chat.py`.
- The deterministic Ollama HTTP fixture exercises real native source reading,
  splitting, embedding requests, persisted index, FAISS query retrieval, line
  metadata in the augmented prompt and streaming chat. It also checks tag
  normalization, timeout settings and native health/model configuration routes.
- Windows combined launcher starts both services; native health and model
  configuration respond successfully. Ctrl+C stops the launched services.
- Headless Edge renders the home page without page errors. The owner/repo form
  opens the configuration modal with Ollama (Local) and qwen3:8b selected.
  Screenshots are in `.local/deepwiki-home.png` and `.local/deepwiki-settings.png`.

## Limits

No live Ollama server was reachable on port 11434, so real model latency,
repository answer quality and a generated wiki were not validated. The fixture
verifies integration, not inference quality. Start Ollama and pull the configured
models before using generation. No paid API requests were made.

Native caches are not the former commit-isolated incremental indexes. Existing
Electron indexes are not migrated; an embedding model change needs a fresh index.
The previous custom confidence display, auto-sync notifications and RepoWise
graph guarantees are not claimed for this replacement. Docker/cloud deployment
and the entire upstream test suite were not validated in this Windows migration.

After compatible patches, npm audit reports 12 dependency advisories (5 low,
1 moderate, 6 high), including transitive braces, KaTeX and PostCSS packages.
Resolving all suggested fixes requires broader dependency changes; no forced
major-version upgrade was applied. An upstream Google SDK deprecation warning
also remains even when Ollama is selected.
