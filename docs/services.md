# Frontend and FastAPI services

Run `npm start` from the repository root. The Node supervisor starts the project Python runtime as a separate FastAPI process, verifies `/api/v1/ready` (including persistent Chroma access), then starts Next.js. Ctrl+C stops both owned process trees. A service exit stops its companion; occupied ports fail with a clear error. Service output appears in the same terminal. Ollama remains a separately managed dependency.

Independent development commands:

- `npm run start:backend`: FastAPI on http://127.0.0.1:8001.
- `npm run start:frontend`: Next.js on http://127.0.0.1:3000; run the backend separately.
- `npm start` / `npm run dev`: both services; do not run these alongside the independent commands.

The Python environment is `.local/deepwiki-tool/runtime`. Run `scripts/setup-deepwiki.ps1` through PowerShell to install locked dependencies. The old `scripts/start-deepwiki.ps1` now delegates to the same Node supervisor, avoiding native inline-Python quoting.

## Routing boundary

Next.js owns UI rendering and thin same-origin HTTP adapters. FastAPI owns request validation, agent/service orchestration, generated documents, Chroma, edit proposals and approval decisions. No model runs in the Next.js server.

All existing FastAPI routes are also exposed under `/api/v1`; legacy routes stay available for compatibility. Next.js adapters share `src/utils/backend.ts`, which appends `/api/v1` to `SERVER_BASE_URL` (an origin, not an API path). WebSocket and code-viewer requests use the same versioned API. Legacy cache paths retain `/api` inside that prefix, e.g. `/api/v1/api/wiki_cache`.

| Capability | FastAPI endpoint |
| --- | --- |
| Readiness | `GET /api/v1/ready` |
| Service discovery | `GET /api/v1/agents` |
| Wiki generation | `POST /api/v1/wiki/tasks` |
| Pipeline progress | `GET /api/v1/wiki/tasks/{task_id}/stream` |
| Inspect retrieved chunks | `POST /api/v1/documents/retrieve` |
| Answer streaming | `POST /api/v1/chat/completions/stream`, WebSocket `/api/v1/ws/chat` |
| Codemap | `POST /api/v1/codemap/stream`, WebSocket `/api/v1/ws/codemap` |
| Propose edits | `POST /api/v1/chat/changes` |
| Accept/reject edits | `POST /api/v1/chat/changes/{proposal_id}/{action}` |

FastAPI interactive documentation: http://127.0.0.1:8001/docs. Edit endpoints retain local-origin/review-header checks; no writes occur merely by generating a proposal. Readiness verifies storage, not model availability or answer quality.
