# Phase 6: integrated desktop workflow

Implemented and verified on 2026-10-09.

## Delivered workflow

- Repository, Documentation, Chat and Settings are separate sidebar views. Repository identity, branch, published commit, notification bell and job/daily-request status stay visible.
- Settings combines local engine controls, encrypted OpenRouter credentials and shared model/request/token settings. Documentation stays manual by default.
- Navigation preserves ordinary drafts, documentation search/selection and per-view scroll positions during the session. Unsaved password input clears when leaving Settings.
- Documentation can prefill and focus Chat through Ask about this file without sending a provider request.
- A shared native source dialog displays validated captured source, commit and line references, supports line wrapping, and restores focus on Escape/close. Open source remains pinned to its original commit during background publication.
- Setup, empty, search and error states guide the user through the existing operations. No new privileged IPC operation or host storage schema was introduced.

## Verification

- Build and TypeScript checks passed.
- `npm test`: 25/25 service and boundary tests passed.
- `npm run test:desktop -- --max-failures=1`: 7/7 actual Electron scenarios passed together (1.7 minutes), including six adapted regressions and the integrated workspace scenario with the production 60-second sync timer.
- `tests/workspace.desktop.ts` connects an owned Git fixture, saves settings, generates documentation, navigates to chat, inspects source, commits an update and waits for automatic publication. It verifies draft preservation, old-source pinning, stale labels, notifications, focus return and unchanged provider usage after sync. Asynchronous citation opening is explicitly awaited before checking background publication.
- Normal and 780px layouts were visually inspected. Screenshots are generated under ignored `test-results/`: `workspace-repository.png`, `workspace-source.png`, `workspace-source-narrow.png` and `workspace-chat-narrow.png`. The narrow flow has no horizontal page overflow or renderer errors.

Electron tests use isolated application data, fake keys and injected fixture-provider responses. No live paid OpenRouter request was made. These checks establish integrated behavior and reference integrity, not real model answer quality. Human-reviewed held-out evaluation, measured live cost/latency, resource/recovery assessment and packaged runtime distribution remain Phase 7 work.
