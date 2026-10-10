# Python 3.14 compatibility — 2026-10-10

Verified CPython 3.14.2 (Windows x64, standard GIL build) in isolated .research/venv314. Installed all 136 existing dependency pins plus unchanged RepoWise 0.55.0 from commit 7f84ae07908de40595fc64b3fe3c910123367a1e. No dependency pin or upstream source modification was necessary.

- Native SQLite, tree-sitter, Pydantic, NumPy and PyArrow imports passed.
- All 34 service/boundary tests passed with CODEBASE_INTELLIGENCE_PYTHON pointing to the 3.14 environment, including committed snapshots, incremental updates, cancellation/recovery, graph reads, retrieval, documentation and workspace export.
- Four actual Electron foundation/repository scenarios passed with the same 3.14 interpreter.
- The read-only python-compatibility.py probe parsed 61 upstream fixtures across 15 language tags. Per-file symbol counts, call counts and parse diagnostics exactly match Python 3.12.14. Some fixtures intentionally contain invalid input; matching diagnostics are not a claim that all constructs are supported.
- Build/typecheck passed. No model calls were needed.

Both Python entry points and the strict TypeScript worker handshake now accept 3.12.x or 3.14.x. UI/errors report both. Other minor versions, free-threaded builds, other operating systems and all future 3.14 patch releases were not separately evaluated.

Reproduce dependency setup using validation/setup_phase1.ps1 -Python 3.14 -Environment .research/venv314 (uv required). Set CODEBASE_INTELLIGENCE_PYTHON to that environment's Scripts/python.exe before npm test or npm run test:desktop. Run python-compatibility.py with a report destination to reproduce the parser comparison. Existing 3.12 environment is preserved.
