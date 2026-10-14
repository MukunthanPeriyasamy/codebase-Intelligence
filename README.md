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

## Configuration and storage

Copy `.env.example` to `.env` if setup has not done so. No paid provider key is needed for Ollama. Other native DeepWiki providers remain available when explicitly configured.

- `OLLAMA_HOST`: defaults to `http://127.0.0.1:11434`.
- `OLLAMA_TIMEOUT_SECONDS`: 900 seconds of read inactivity for local inference; connection timeout is 10 seconds.
- `DEEPWIKI_DATA_DIR`: optional absolute storage path. Default: `.local/deepwiki-data` in this project.
- Repository clones, embedding databases and generated wiki caches live under that data directory. Native local-repository input reads its original folder.

Changing the embedding model requires rebuilding the affected repository index. This is DeepWiki's native repository cache, not the previous commit-isolated incremental index. Old Electron workspace data and external RepoWise installations are preserved but unused. They are not automatically imported. The previous code is recoverable from Git commit `f8ac2ac`.

The Windows launcher binds both services to this computer only. This is an internal local application; hosted deployment needs separate configuration.

See `validation/full-deepwiki.md` for verification and remaining limitations. Historical validation documents describe the retired implementation.
