# Generated-document RAG

Generation now finishes with overlapping document chunking (2,000 characters, stride 1,600), batched Ollama `/api/embed` calls, persistent Chroma insertion, record-count verification, and atomic session-manifest publication. The wiki cache stores its `document_index`. Progress includes chunking, embedding counts and vector-store verification. A failed batch is removed and the task fails without publishing an incomplete index.

Set the Ollama embedding model in Generate Wiki or Refresh Wiki. Default: `nomic-embed-text`. It must already be installed on the backend Ollama host (`OLLAMA_HOST`, default `http://127.0.0.1:11434`). For local setup: start Ollama and run `ollama pull nomic-embed-text`. Restart the backend after installing the updated requirements. Existing wikis need regeneration once to create this new index; old lexical-only caches are not silently substituted.

One persistent database lives in `DEEPWIKI_DATA_DIR/document-chroma`. Collections distinguish model names and vector dimensions; repositories and document sessions share these collections. Every query requires equality filters on `repo_id`, `session_id`, `language`, and `embedding_model`. Server-generated document-session UUIDs identify generated wiki versions, not chat-history threads. Queries use the model saved in that session. Different chats may reference the same wiki session without duplicating its vectors. Session manifests live in `document-sessions`.

Answer flow: user intent → query embedding → filtered Chroma search (six closest chunks) → context-budgeted document excerpts with [D1] labels → answer stream with document references. No source reading or secondary answer-validation model runs on this path during this RAG verification phase. The prompt requires evidence, distinguishes application and chat models, handles missing evidence, and treats document instructions as untrusted. Nearest-neighbour retrieval does not guarantee relevance; missing information must be stated by the answering model. Edit proposals retain current-source checks and explicit accept/reject.

## Inspect retrieval before generation

POST `/documents/retrieve` to the backend with the same request body as chat, including `repo_url`, `type`, `language`, `document_session_id`, and a user message. The response contains index metadata, selected chunk text, chunk IDs, document line ranges and vector distances. It does not call an answer model or inspect repository source. Omitting the session selects the latest matching cached wiki. Missing documentation returns 404 with `No document Found Generate One`; an unindexed legacy wiki returns 409 with regeneration instructions.

Example body:
```json
{"repo_url":"https://github.com/owner/project","type":"github","language":"en","document_session_id":"<32-character session from wiki cache>","messages":[{"role":"user","content":"Which LLM does this application use?"}]}
```

Tests in `tests/test_document_store.py` use real persistent Chroma with controlled embeddings. They cover repository/session/language isolation, persistence, more than 256 chunks, rollback, missing indexes, diagnostics and documentation-only generation. `tests/test_local_ollama_pipeline.py` exercises the native HTTP embedding/chat protocol with a local fixture server. These are not substitutes for a live Ollama quality evaluation.
