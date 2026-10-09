# Documentation failure diagnostics — 2026-10-09

The reported UI displayed one generic error for transport, truncation, JSON and schema failures. Inspection also found the response parser rejected nullable usage.cost, preventing otherwise valid documentation from publishing.

The adapter now accepts null/absent cost and classifies failures with fixed safe error codes, actionable instructions, output limits and completion-token counts when available. Raw response bodies, provider error messages, arbitrary schema keys and secrets are not exposed. Reported cost is retained for rejected documentation responses; unknown cost stays unknown. No automatic paid retry is added.

The Documentation view displays a bordered error alert, selectable expanded debug context and a Settings action. Failure summaries continue through existing persistent notifications.

Validation: build/typecheck passed; all 34 service tests passed; targeted Electron documentation and chat scenarios passed. The documentation fixture first returns truncated output, then successfully generates, resumes, exports Markdown and resolves citations. Screenshot: ../test-results/documentation-error.png. Tests use isolated fixture credentials and providers; no paid requests were made.

The exact cause of the original six failed requests remains unknown because the old implementation discarded response diagnostics. Real-model output quality and generation with the user's selected provider were not tested.
