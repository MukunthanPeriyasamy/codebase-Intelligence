# Reviewed code edits and persistent chat — 2026-10-15

## Behavior

The user explicitly extended the previous read-only chat scope. Fast, Deep Research
and Codemap remain explanation modes; Edit code creates a proposal. The root chat
prompts describe this capability and direct modification requests to Edit code.
The model has no write or command-execution tool.

Edit code calls the existing native preparation/retrieval pipeline, then reads the
current complete text of retrieved files. Context is bounded by an estimated
token budget for the selected model. Replacements must match one exact source
block; new files and explicit whole-file deletions are supported. Plans are
limited to 12 operations, 100 KB per file, and UTF-8 text. Files too large for the
model context are omitted; insufficient evidence fails without a proposal.

The UI shows chat and unified diffs in equal-width columns, with the destination
path and fixed Accept/Reject footer. Proposals, original/replacement contents and
review status persist in `changes.sqlite3` beneath the configured data directory.
Only accepting a server-stored pending proposal applies changes. Rejecting and
reopening proposals cannot write source. Accept checks all original contents
before writing, blocks traversal/metadata/linked paths, serializes decisions and
uses atomic per-file replacement with rollback for ordinary write failures.
Local-origin checks and a required review header guard the new API/proxy routes.
Chat Markdown disables raw HTML so model replies cannot embed active HTML.

Acceptance invalidates the native embedding database. The next request rebuilds
it. Existing wiki pages remain unchanged until explicit regeneration. Remote
repositories use their DeepWiki-managed local clone; no Git commit, push, or test
execution is performed. Source locations are shown before approval.

## Conversation history

Previously, earlier turns existed only in mounted React state. New history is
browser-local and scoped by repository type and URL/path. It retains individual
conversations, drafts, normal turns, research stages, codemaps, and proposal IDs.
The history control is beside the response-mode menu below the composer. New chat
preserves old sessions; selecting a session restores its turns for subsequent
requests. Interrupted responses are marked incomplete. Proposal status is fetched
from the server on reopening; no approval is replayed. Provider access tokens are
not included in saved snapshots. Storage load/save failures are visible.

## Verification

- Existing native Ollama/config/name/chat regressions and the new change-review
  tests pass together: **60 tests**.
- An additional native HTTP-fixture test passed: source reading, embeddings,
  FAISS retrieval, model proposal, unchanged source before acceptance, exact
  accepted contents and index invalidation. The focused edit/native suite has
  23 tests, including this additional test.
- Production build and TypeScript checks pass. Four existing lint warnings remain
  about the font link and hook dependencies.
- Headless Edge browser regression passes: equal-width review, no automatic
  approval, rejection, acceptance, proposal/draft restoration, new/select chat,
  reload, follow-up context, repository isolation, and saved research-stage and
  codemap rendering. No browser page errors occurred in the final run.
- Fixed a browser error where the old catch-all vendor splitChunks override
  caused a stylesheet to load as JavaScript. Native Next chunk handling is used.
- A real frontend-proxy smoke test also caught Next's normalization of nextUrl to
  localhost. Review origin checks compare the actual Host header and an explicit
  local-origin allowlist, so the default 127.0.0.1 address is supported.
- The final real proxy smoke test passes: Next route to FastAPI acceptance applies
  the exact reviewed content to an isolated fixture file; absent, foreign and
  mismatched origins are refused without writing.

Reproduce backend checks with the configured tokenizer cache and isolated runtime:

```powershell
$env:TIKTOKEN_CACHE_DIR = "$PWD/.local/deepwiki-tool/token-cache"
.local/deepwiki-tool/runtime/Scripts/python.exe -m pytest tests/test_change_review.py tests/test_local_ollama_pipeline.py tests/test_config.py tests/test_extract_repo_name.py tests/unit/test_chat.py -q
npm run build
```

Run `node tests/chat-review-ui.cjs` against the frontend on port 3000. It uses the
existing local Playwright install (or `PLAYWRIGHT_MODULE`) and headless Edge, with
fixture responses and an isolated browser context. Screenshot:
`.local/chat-review.png`. No user repository is modified by this browser test.

The actual proxy can be checked with `tests/review-proxy-fixture.py` on port 8001
and the frontend on 3000, followed by `node tests/review-proxy-smoke.cjs`. Set
`PYTHONPATH` to the repository root and the tokenizer cache as above for the
fixture server. It uses an isolated temporary folder under `.local`; do not run
it alongside the normal API server on the same port.

## Limits

Real model edit quality/latency is not established by fixtures. Review is essential;
the system does not execute tests on proposed or accepted changes. Token counts
are estimates. Chat history is specific to this browser/origin, not shared across
devices; browser data clearing removes it. Simultaneous-tab history merging is
not implemented. Multi-file power-loss atomicity and concurrent external editor
locking are not claimed; proposals retain originals for manual recovery. A crash
during application may leave a partial batch, and stale checks prevent blind
reapplication. Generated wiki refresh is manual.
