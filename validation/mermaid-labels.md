# Mermaid nested-label repair

The reported `E(LLM (Groq))` flowchart node failed because its nested parentheses
were unquoted. Mermaid requires `E("LLM (Groq)")` for this rounded-node label.
This was generated diagram syntax, not a Next.js or Turbopack version failure.

The renderer validates the original source first. If invalid, it attempts a narrow
repair of balanced nested parentheses in unquoted rounded-node labels, then
validates again before rendering. Valid diagrams are not rewritten. Other errors
show an inline explanation and the original source as escaped React text. The
previous raw innerHTML error fallback and redundant automatic rendering were
removed. Wiki and Codemap generation prompts now show the quoted-label syntax.

Verification: TypeScript (`npx tsc --noEmit`), targeted ESLint, and
`node tests/mermaid-render.cjs` passed. The browser regression uses the installed
Mermaid parser and SVG renderer in headless Edge: the reported diagram renders
with its label intact, quoted strings/comments/compound shapes remain unchanged,
and invalid syntax fails validation without console errors. This does not claim
automatic repair of arbitrary malformed Mermaid syntax.
