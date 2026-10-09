# Local Ollama replacement — 2026-10-09

OpenRouter transport, credential storage implementation and credential IPC/UI have been removed. Documentation and chat use the native Ollama API at the fixed loopback origin http://127.0.0.1:11434. No API key or arbitrary endpoint is accepted. Cloud models and redirects are rejected. Catalog checks use /api/tags and /api/show and do not run inference; capability metadata separates completion and embedding models.

Generation uses JSON-schema format, stream=false, temperature=0, num_ctx=32768 and the saved num_predict output limit. Thinking is disabled for models advertising that capability. Source/quote/schema validation remains unchanged. Response reads are limited to 2 MiB; local inference allows ten minutes. Defaults are 8000 output tokens, one request/run, 20/day and manual generation. Maximum output is 16384 tokens. Truncation and connection errors remain explicit; no automatic retry occurs.

Existing remote settings are backed up to knowledge/documentation/settings.before-ollama.json and reset to local manual setup with no selected model. Historical request/cost accounting and published documents remain intact. New jobs and chat caches are provider-versioned. Existing encrypted key files remain unused; the app never decrypts them.

Verification: build/typecheck passed and all 33 service tests passed. All 10 Electron scenarios passed across targeted runs. Fixture checks cover connection, capability discovery, model persistence, failure refresh, generation/truncation/resume, citations, Markdown export, chat, migration without key access, graph rendering and background-sync navigation. No actual model was run or downloaded. A read-only probe found no Ollama server listening on 127.0.0.1:11434, so real-model quality, latency and hardware fit remain unverified.

To use: install/start Ollama; run ollama pull qwen2.5-coder:14b (or the smaller :7b); restart this app, test the connection in Settings, refresh chat models, select the installed model, save settings and generate one page. Embedding selection is supported; vector generation remains separate pending work.
