"""Multilingual syntax evidence. Never executes analyzed code or guesses dispatch."""
from pathlib import Path
import re
import json
import subprocess
import sys

LANGUAGES = {
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "tsx",
    ".ts": "typescript", ".tsx": "tsx", ".java": "java", ".c": "c", ".h": "cpp",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".go": "go",
    ".rs": "rust", ".php": "php", ".swift": "swift", ".cs": "csharp",
    ".kt": "kotlin", ".kts": "kotlin", ".rb": "ruby", ".dart": "dart",
    ".scala": "scala", ".lua": "lua", ".sh": "bash", ".bash": "bash",
    ".ps1": "powershell", ".r": "r", ".ex": "elixir", ".exs": "elixir",
    ".jl": "julia", ".sql": "sql", ".html": "html", ".css": "css",
    ".scss": "scss", ".vue": "vue", ".svelte": "svelte",
}
FUNCTIONS = {
    "function_declaration", "function_definition", "function_expression", "generator_function",
    "generator_function_declaration", "arrow_function", "method_definition", "method_declaration",
    "constructor_declaration", "destructor_declaration", "local_function_statement", "function_item",
    "closure_expression", "lambda_expression", "anonymous_function_creation_expression",
    "anonymous_function", "anonymous_method_expression", "lambda_literal", "method", "singleton_method",
    "function_signature", "method_signature", "function_literal", "func_literal",
    "function_statement", "function", "function_declarator", "function_expression_body",
    "accessor_declaration", "operator_declaration", "conversion_operator_declaration",
    "create_function", "create_procedure",
}
CALLS = {"call_expression", "method_invocation", "invocation_expression", "function_call_expression",
         "member_call_expression", "scoped_call_expression", "call", "command", "method_call"}
RETURNS = {"return_statement", "return_expression", "yield_expression", "yield_statement", "return", "yield",
           "control_transfer_statement", "jump_expression", "flow_control_statement", "call"}
ERRORS = {"try_statement", "try_expression", "try_block", "catch_clause", "catch_block", "finally_clause",
          "throw_statement", "throw_expression", "rescue", "rescue_modifier", "ensure", "defer_statement"}
IMPORTS = {"import_statement", "import_declaration", "import_header", "using_directive", "use_declaration",
           "namespace_use_declaration", "preproc_include", "import", "require", "package_clause"}


def walk(node, stop_functions=False):
    stack = list(reversed(node.named_children))
    while stack:
        child = stack.pop()
        if stop_functions and child.type in FUNCTIONS:
            continue
        yield child
        stack.extend(reversed(child.named_children))


def text(node):
    return node.text.decode("utf-8") if node is not None else ""


def field(node, *names):
    for name in names:
        value = node.child_by_field_name(name)
        if value is not None:
            return value
    return None


def span(node):
    return [node.start_point.row + 1, node.end_point.row + (1 if node.end_point.column else 0)]


def scan(path, source):
    """Keep native parser faults outside the API process; fail the task explicitly."""
    if Path(path).suffix.lower() not in LANGUAGES:
        return {"language": "unknown", "status": "unsupported", "functions": [], "imports": [], "calls": []}
    try:
        result = subprocess.run(
            [sys.executable, "-X", "faulthandler", str(Path(__file__).resolve())],
            input=json.dumps({"path": path, "source": source}),
            capture_output=True, text=True, encoding="utf-8", timeout=60,
            cwd=str(Path(__file__).resolve().parents[3]),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Syntax analysis timed out for {path}; no complete documentation was published.") from exc
    if result.returncode:
        from api.utils import deepwiki_root
        import uuid
        log = Path(deepwiki_root()) / "parser-faults" / (uuid.uuid4().hex + ".log")
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text(f"File: {path}\nExit: {result.returncode}\n{result.stderr}", encoding="utf-8")
        raise RuntimeError(f"Syntax parser failed for {path} (exit {result.returncode}); backend remains available. Diagnostics: {log}")
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f"Syntax parser returned invalid evidence for {path}") from exc


def _scan(path, source):
    language = LANGUAGES.get(Path(path).suffix.lower())
    if not language:
        return {"language": "unknown", "status": "unsupported", "functions": [], "imports": [], "calls": []}
    try:
        from tree_sitter_language_pack import get_parser
        parser = get_parser(language)
        tree = parser.parse(source.encode("utf-8"))
        root = tree.root_node
    except (ImportError, LookupError, RuntimeError, ValueError) as exc:
        return {"language": language, "status": f"parser unavailable: {type(exc).__name__}", "functions": [], "imports": [], "calls": []}
    if language in {"html", "vue", "svelte"}:
        embedded = []
        for match in re.finditer(r"<script\b([^>]*)>([\s\S]*?)</script\s*>", source, re.IGNORECASE):
            attrs, code = match.groups()
            if re.search(r"type\s*=\s*['\"]application/(?:ld\+)?json", attrs, re.I):
                continue
            suffix = ".ts" if re.search(r"lang\s*=\s*['\"](?:ts|typescript)['\"]", attrs, re.I) else ".js"
            embedded.append(_scan("embedded" + suffix, "\n" * source[:match.start(2)].count("\n") + code))
        return {"language": language, "status": "partial: syntax errors" if root.has_error or any(s["status"] != "parsed" for s in embedded) else "parsed",
                "scope": "script blocks; template expressions are not function-inventoried",
                "functions": [f for s in embedded for f in s["functions"]],
                "calls": [c for s in embedded for c in s["calls"]], "imports": [i for s in embedded for i in s["imports"]]}
    nodes = list(walk(root))
    imports = [{"text": text(n), "lines": span(n)} for n in nodes if n.type in IMPORTS]
    calls = [{"text": text(n), "callee": text(field(n, "function", "name", "method")),
              "lines": span(n), "consumer": text(n.parent) if n.parent else ""} for n in nodes if n.type in CALLS]
    functions = []
    for node in nodes:
        elixir_definition = language == "elixir" and node.type == "call" and text(field(node, "target")) in {"def", "defp", "defmacro", "defmacrop"}
        if node.type not in FUNCTIONS and not elixir_definition:
            continue
        # C/C++ declarations live inside a definition; avoid counting both.
        if node.type == "function_declarator" and any(p.type in {"function_definition", "function_declarator"} for p in ancestors(node)):
            continue
        if node.type in {"function_signature", "method_signature"} and any(p.type in FUNCTIONS for p in ancestors(node)):
            continue
        name_node = field(node, "name")
        if language == "r" and node.parent:
            name_node = field(node.parent, "lhs", "left")
        if name_node is None and node.type in {"arrow_function", "closure_expression", "lambda_expression", "function_expression"} and node.parent:
            name_node = field(node.parent, "name", "left", "key", "pattern")
        declarator = field(node, "declarator")
        while declarator is not None:
            name_node = field(declarator, "declarator", "name") or name_node
            declarator = field(declarator, "declarator")
        if name_node is None:
            name_node = next((n for n in node.named_children if n.type in {"identifier", "simple_identifier", "name", "function_name"}), None)
        if name_node is None and language in {"julia", "sql", "dart"}:
            name_node = next((n for n in walk(node) if n.type in {"identifier", "name"}), None)
        if elixir_definition:
            declaration = next((n for n in walk(node) if n.type == "call"), None)
            name_node = field(declaration, "target") if declaration is not None else None
        if name_node is None and node.parent and node.parent.type in {"variable_declarator", "assignment_expression", "pair"}:
            name_node = field(node.parent, "name", "left", "key")
        name = text(name_node) or f"anonymous@{node.start_point.row + 1}:{node.start_point.column}"
        body = field(node, "body")
        if body is None:
            body = next((n for n in node.named_children if n.type in {"function_body", "block", "body_statement", "script_block"}), None)
        # Dart separates a function's signature from its body as siblings.
        if body is None and node.type in {"function_signature", "method_signature", "create_function", "create_procedure"}:
            sibling = node.next_named_sibling
            while sibling is not None:
                if sibling.type == "function_body":
                    body = sibling
                    break
                if node.type in {"function_signature", "method_signature"}:
                    break
                sibling = sibling.next_named_sibling
        if body is None and language in {"julia", "elixir", "powershell", "r"}:
            body = node
        end = body.end_byte if body is not None else node.end_byte
        source_bytes = source.encode("utf-8")
        signature = source_bytes[node.start_byte:(body.start_byte if body is not None and body != node else node.end_byte)].decode("utf-8")
        owned = [body, *walk(body, True)] if body is not None else []
        owned = [n for n in owned if n is not None]
        if elixir_definition and declaration is not None:
            owned = [n for n in owned if n.start_byte >= declaration.end_byte]
        params = field(node, "parameters", "parameter")
        if params is None:
            params = next((n for n in walk(node) if n.type in {"parameter_list", "formal_parameters", "formal_parameter_list", "function_value_parameters", "parameters"}), None)
        scope = [text(field(p, "name")) for p in ancestors(node) if p.type in {"class_declaration", "class_definition", "impl_item", "struct_item"}]
        functions.append({"name": ".".join([*reversed([s for s in scope if s]), name]), "language": language,
            "lines": [node.start_point.row + 1, (body or node).end_point.row + 1],
            "signature": signature.strip(), "parameters": text(params) or "See exact signature (grammar has no separate parameter field).",
            "return_type": text(field(node, "return_type", "returns", "result", "type")) or "Not explicitly resolved; see signature.",
            "calls": [{"text": text(n), "lines": span(n), "consumer": text(n.parent)} for n in owned if n.type in CALLS],
            "returns": [{"text": text(n), "lines": span(n)} for n in owned if n.type in RETURNS and re.match(r"\s*(return|yield)\b", text(n))],
            "errors": [{"text": text(n), "lines": span(n)} for n in owned if n.type in ERRORS],
            "code": source_bytes[node.start_byte:end].decode("utf-8"),
            "implicit_result": text(body.named_children[-1]) if body is not None and body.named_children else text(body),
        })
    return {"language": language, "status": "partial: syntax errors" if root.has_error else "parsed",
            "functions": functions, "imports": imports, "calls": calls,
            "classes": [{"name": text(field(n, "name")), "start_line": span(n)[0], "end_line": span(n)[1]}
                        for n in nodes if n.type in {"class_declaration", "class_definition", "class", "struct_item", "interface_declaration"}]}


def ancestors(node):
    parent = node.parent
    while parent is not None:
        yield parent
        parent = parent.parent


if __name__ == "__main__":
    # JSON contains source as data; it is parsed, never executed.
    payload = json.load(sys.stdin)
    print(json.dumps(_scan(payload["path"], payload["source"]), ensure_ascii=True))
