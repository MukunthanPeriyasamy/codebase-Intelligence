# Multilingual documentation and schema-first retrieval

## Implemented workflow

User prompt -> document schema -> relevant document chunks -> cross-check only documented source files -> analyze the request -> answer or proposed diff -> explicit user decision. Accept applies the stored proposal after stale-source checks; Reject leaves source unchanged. No relevant documentation returns exactly `No document Found Generate One` without source fallback or model inference.

The saved `documentation_schema` contains Frontend, Backend, Databases, API, Domain, Business, Application, Configuration, Tests and General branches, plus page IDs, file paths, chunk offsets and extracted source ranges. Classification uses document titles and primary file paths; it is a routing heuristic, not proof of architectural responsibility. Retrieval rebuilds the schema from cache content (including legacy caches), searches matching branches and documented connections first, and widens only within the document index if needed. Review provenance includes the selected areas.

## Language-independent reference generation

The prior Python-only baseline is superseded. Python ASTs and bundled multilingual Tree-sitter grammars produce function/method/anonymous-function reference records with signature and parameter evidence, calls and passed expressions, return/yield evidence, candidate callers/result consumers, imports, error/cleanup constructs, and numbered implementations. Long definitions continue across pages. Source-level callbacks, implicit returns and dispatch remain candidates when semantics cannot be proven.

Parser regression fixtures cover 26 source formats: JS, TS, JSX, TSX, Java, C, C++, Go, Rust, PHP, Swift, C#, Kotlin, Ruby, Dart, Scala, Lua, Bash, PowerShell, R, Elixir, Julia, SQL, Vue, Svelte and HTML. Python has separate nested/function/lambda tests. HTML/Vue/Svelte coverage targets script blocks; template-expression functions are not inventoried. Configured aliases include additional suffixes for these languages.

Unknown source languages are no longer discarded solely by the extension allowlist during documentation generation. Bounded visible UTF-8 text retains numbered evidence and per-slice model analysis, explicitly marked unsupported/unverified. Exclusions, binary checks, hidden fallback files and size limits still apply. Exclusion glob patterns now work. The ordinary source index keeps its extension rules.

Dependencies: `tree-sitter-language-pack==0.13.0` and `tree-sitter==0.26.0`, with pinned transitive parser bindings in requirements.lock. Version 0.13.0 bundles grammars; no parser downloads occur during documentation generation. Package documentation: https://pypi.org/project/tree-sitter-language-pack/0.13.0/. Re-run the existing setup script on other machines to install dependencies.

## Original failure and guardrails

The reported edit referenced a path absent from supplied current-source context, or mixed formats under the previous combined check. Failed raw model output was not retained, so that specific cause cannot be reconstructed. Summary-only retrieval and the file-filter argument-order bug were confirmed coverage problems and corrected. Edit prompts now list exact supplied paths and omissions. A better document inventory does not guarantee a small model can remove a whole subsystem in one proposal.

Connected Python imports/callers and multilingual name-based call candidates are included in file provenance. These are syntax candidates, not verified runtime links; overloads, shadowing, external consumers and cross-language bridges can remain unresolved. No analyzed code is executed. Parsed syntax does not establish exhaustive semantic correctness in any language. Limits remain 1 MB per documentation file, 100 KB per editable file, 12 editable files and bounded model context.

Source analysis failures retain numbered evidence. Navigation/progress carries metadata rather than duplicating full source on each event. Code snippets keep their closing Markdown fences. Existing caches require **Refresh Wiki** to gain the new function references; document schemas can be rebuilt from old documents without code lookup.

## Verification

130 backend tests passed across parser fixtures, reference generation, document schemas, HTTP/WebSocket missing-document stops, review/approval checks, wiki lifecycle and configuration filters. TypeScript and targeted frontend ESLint passed. `uv pip check` confirms compatible installed packages. Tests use deterministic model fixtures; live Gemma quality and the external OCR repository remain unverified.

Reproduce with the configured tokenizer cache and local Python runtime:

```powershell
$env:TIKTOKEN_CACHE_DIR = "$PWD/.local/deepwiki-tool/token-cache"
.local/deepwiki-tool/runtime/Scripts/python.exe -m pytest tests/backend tests/test_document_first.py tests/test_document_schema.py tests/test_change_review.py tests/test_local_ollama_pipeline.py tests/test_config.py -q
npx tsc --noEmit
```
