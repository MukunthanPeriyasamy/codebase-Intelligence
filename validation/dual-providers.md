# Ollama and OpenRouter together — 2026-10-10

Implemented explicit provider selection for chat/documentation and provider-specific model catalogs. Ollama remains the default; its fixed loopback transport is unchanged. OpenRouter uses host-only HTTPS requests, encrypted key storage, strict JSON-schema output, bounded source, a two-minute timeout and no automatic retry/fallback. Nullable costs and truncated output retain actionable diagnostics; available failure costs are recorded in documentation and interactive requests.

Model and embedding profiles persist separately. Switching provider disables automatic generation. Shared request accounting is preserved, jobs/caches distinguish provider, and generated pages/answers record provider provenance. Existing local documents and Python 3.12/3.14 support are preserved. Embedding execution remains pending.

Verification: build/typecheck and all 38 service tests passed. Seven targeted Electron scenarios passed across runs: local documentation/chat, foundation/key recovery, model settings, and the new dual-provider workflow. The new scenario saves a genuinely OS-encrypted fixture key, verifies it is absent from status/on-disk plaintext, generates remote documentation and chat through fixture transport, switches back to Ollama without a key header, restores remote model selection, and verifies provider/key persistence after restart. Settings screenshot visually inspected. No paid or live remote generation calls were made. Live model quality remains unverified.

Setup: restart the rebuilt app; Settings -> Connect OpenRouter -> save key; Generation settings -> Model provider -> OpenRouter; refresh/select models and Save generation settings. Choose Ollama to return to local inference. Catalog reads do not invoke generation.
