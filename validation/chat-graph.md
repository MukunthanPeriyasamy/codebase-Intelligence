# Full-section chat and live graph

Implemented and verified on 2026-10-09.

- Chat fills the available section beneath the persistent app header/status strip. Its conversation scrolls independently of the bottom composer. Enter sends, Shift+Enter adds a line, accepted submissions clear the input, and unsent drafts survive navigation. Existing citations, old-commit labels, cost/cache details and cancellation remain available.
- Repository now contains adjacent Repository and Knowledge Graph views. React Flow 12.12.0 renders actual captured files, extracted symbols and explicitly unresolved call targets. Filtering, selection details, pan/zoom/fit controls, minimap, build progress and commit identity are available.
- The visible dashboard reads every three seconds and on publication. The host chooses an app-owned staging checkpoint or published snapshot; the renderer supplies no filesystem paths. SQLite reads use a consistent read-only transaction. Staging previews are labelled and never used as chat evidence.
- Display limits are 60 files, 20 symbols and 20 call records per file, 240 nodes and 400 edges; omissions are disclosed. The graph does not claim resolved cross-file dependencies or proven runtime behavior.

## Executed verification

- `npm test`: **28/28** service/boundary tests passed, including incomplete graph checkpoints, wrong-commit rejection, published-completeness requirements, bounded large graphs and endpoint integrity.
- `npm run test:desktop -- --max-failures=1`: build/typecheck and **9/9** actual Electron scenarios passed together (2.2 minutes).
- The new graph desktop test uses a real committed Python fixture, checks extracted containment/call nodes, filtering and details, commits a replacement symbol and verifies automatic graph refresh after publication. It also checks full-section chat width, keyboard sending, multiline drafts, visible composer and narrow layout.
- Existing chat, documentation, model settings, credentials, repository notifications and actual 60-second background-sync scenarios passed. No paid provider calls were made.
- Inspected `test-results/knowledge-graph.png` and `test-results/full-chat-narrow.png`; screenshots are ignored local artifacts. Build emits a React Flow client-directive notice and a bundle-size advisory; neither blocks compilation or the verified desktop workflows.

Workspace-directory selection, document export, vector indexing/re-embedding and sequential vector/KG/source retrieval remain separate pending work. This implementation completes the two requested presentation units.
