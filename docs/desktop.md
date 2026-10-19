# DeepWiki Studio desktop

Run `npm install`, then `npm start`. The launcher starts Electron, starts the existing
FastAPI backend, verifies its Chroma readiness, starts Next.js, and opens the editor
after the frontend responds. A startup failure is displayed in a native dialog and
the terminal. Ports 3000 and 8001 must be free; existing processes are never taken over.

The Python runtime must already be prepared using `scripts/setup-deepwiki.ps1`.
Setup selects Python 3.12 explicitly, using uv to obtain it when needed. If a previous
attempt created a Python 3.14 or incomplete runtime, setup preserves it under
`.local/deepwiki-tool/runtime-backup-*` and creates a supported environment. Close any
running backend before rerunning setup. The requirements lock targets Python 3.12;
do not enable prereleases to work around a Python-version dependency conflict.
Ollama remains an external model service. Start it separately for local model answers.
CodeGraphContext retains its optional isolated setup (`npm run setup:kg`).

## Workspace

- Left: native folder selection, lazy directory tree, visible-file filtering, file
  and folder creation, refresh. Dependency/cache directories are hidden.
- Center: local Monaco editor with syntax highlighting, tabs, line numbers, find,
  undo/redo, dirty indicators, save button and Ctrl/Cmd+S. Columns can be resized.
- Right: existing chat, modes, history, model selection and MCP commands. Local
  repository requests and natural-language KG queries use the selected workspace.
- Code citations open the corresponding file. Edit proposals appear in the center
  canvas with the existing Accept/Reject flow. Accepted changes refresh clean editor
  buffers; dirty buffers stay intact and subsequent saves detect disk conflicts.
- Documentation workspace opens in a separate desktop window using the existing
  wiki interface. It shares the same managed frontend and backend.

Manual saves require matching the hash read from disk; externally changed files
produce a conflict instead of being overwritten. Use Reload to explicitly discard
the buffer and read the new version. Closing a dirty tab, changing folders or closing
the window asks before discarding unsaved work. Files are UTF-8 text up to 2 MB.
Other encodings and binary files are not editable in this version.

The renderer has no Node access. A sandboxed preload exposes only folder selection,
listing, reading, creating and saving within the chosen root. IPC checks the sender
and real paths; traversal and links escaping the root are rejected. Monaco is served
locally rather than downloaded from a CDN. External links open in the default browser.

Closing the main window stops the service process tree it owns, including the KG
child. `npm run start:web` retains browser-only operation. `npm run start:backend`
and `npm run start:frontend` retain their independent service commands.

This is a runnable source-checkout desktop application. It currently uses the Next
development server and the prepared project Python runtime. A signed distributable
installer with bundled Python/models is not included; packaging is a separate step.

## Verification

`node --test tests/electron-workspace.cjs` checks saving, stale-write rejection,
workspace boundaries, binary rejection and file creation. `node tests/electron-smoke.cjs`
uses Playwright from `.local/ui-test/node_modules/playwright` to start real Electron
and services, open a fixture folder, type into Monaco, save and create files, route a
KG question (mock model response), and render the approval panel in the center column.
It writes its screenshot and fixture files under `.local`.

The existing document-first editing rules are unchanged. Switching to Electron does
not fix missing document evidence or model-generated invalid edit proposals.
