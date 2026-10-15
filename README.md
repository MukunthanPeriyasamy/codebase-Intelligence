# DeepWiki with Ollama

This project now runs the complete DeepWiki web application: repository cloning, code indexing, embeddings, FAISS retrieval, wiki generation, diagrams and streaming repository chat. The Electron application and its custom backend have been retired.

Based on [AsyncFuncAI/deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open) at `d92819a9c9f3b99416e3580ff235fc9d3adf8b89`, under the included MIT license. Original README: `README.upstream.md`.

## Windows setup

Install Git, Node.js (22 LTS or newer), Python 3.12, [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Ollama](https://ollama.com/). From this project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-deepwiki.ps1 -Python C:\path\to\python.exe
ollama pull qwen3:8b
ollama pull nomic-embed-text
npm start
```

Keep Ollama running. Open **http://127.0.0.1:3000**, enter your repository and select Ollama. `qwen3:8b` is the generation/chat default; choose another installed model in the configuration screen if needed. Embeddings use `nomic-embed-text`, configured in `api/config/embedder.json`. Model downloads are explicit, not performed by setup. Hardware limits can require a smaller model, such as the included `qwen3:1.7b` option.

Setup installs frontend and backend dependencies. `npm start` starts both local servers. Backend logs are in `.local/logs/`. Press Ctrl+C to stop. `npm run build` checks the production frontend build. `npm run dev:ui` starts only the frontend.

## Chat editing and history

Choose **Edit code** below the chat input to request a code change. Generated wiki documentation is required: relevant document chunks are retrieved first, then their referenced files are cross-checked against current source. Without relevant documentation, chat returns `No document Found Generate One` and stops before reading source or calling the model. The model proposes edits using original numbered source lines, and the review panel lists the documentation used. Chat and the diff occupy equal halves of the panel. Review every file, then choose **Accept** to apply the whole proposal or **Reject** to leave files unchanged. Chat answers and model output never directly write files.

The diff shows the destination folder. Local repositories are edited in their original folder; remote repositories are edited in DeepWiki's local clone, without committing or pushing. Changed files are checked again on acceptance; conflicts require a fresh proposal. Accepted changes invalidate the repository embedding cache, which rebuilds when the source-indexing pipeline next runs. Existing wiki pages must be regenerated separately. Tests are not run automatically. Text-file replacements, additions and explicit deletions are supported, bounded to 12 edits and 100 KB per file; binary files, linked paths and Git metadata cannot be edited.

**Chat history**, beside the response-mode menu, saves separate conversations and drafts in this browser for each repository. **New chat** preserves the previous conversation, and selecting it restores its turns for follow-up context. History also retains research stages, codemaps and links to proposals. Interrupted answers are marked incomplete. Browser storage failures are displayed; clearing browser data removes this history. Proposals and their review status are stored separately in `DEEPWIKI_DATA_DIR/changes.sqlite3` and are rechecked when reopened.

## Configuration and storage

Copy `.env.example` to `.env` if setup has not done so. No paid provider key is needed for Ollama. Other native DeepWiki providers remain available when explicitly configured.

- `OLLAMA_HOST`: defaults to `http://127.0.0.1:11434`.
- `OLLAMA_TIMEOUT_SECONDS`: 900 seconds of read inactivity for local inference; connection timeout is 10 seconds.
- `DEEPWIKI_DATA_DIR`: optional absolute storage path. Default: `.local/deepwiki-data` in this project.
- Repository clones, embedding databases and generated wiki caches live under that data directory. Native local-repository input reads its original folder.

Changing the embedding model requires rebuilding the affected repository index. This is DeepWiki's native repository cache, not the previous commit-isolated incremental index. Old Electron workspace data and external RepoWise installations are preserved but unused. They are not automatically imported. The previous code is recoverable from Git commit `f8ac2ac`.

The Windows launcher binds both services to this computer only. This is an internal local application; hosted deployment needs separate configuration.

See `validation/full-deepwiki.md` for verification and remaining limitations. Historical validation documents describe the retired implementation.
