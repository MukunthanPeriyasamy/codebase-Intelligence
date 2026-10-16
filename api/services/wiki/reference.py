"""Source-derived documentation, independent of model top-k retrieval.

Python ASTs and multilingual syntax trees provide static facts without executing
repository code. Connections are syntactic candidates, not proof of runtime
dispatch or values. Unsupported syntax retains numbered evidence and explicit gaps.
"""
import ast
import hashlib
from pathlib import Path

from api.schemas import WikiPage, WikiSection
from api.services.source_files import safe_path
from api.services.wiki.polyglot import scan as scan_language


def page_id(value):
    return "reference-" + hashlib.sha256(value.encode()).hexdigest()[:20]


def snippet(text, start, end):
    lines = text.splitlines()
    # A longer fence prevents repository code from terminating the code block.
    fence = "`" * max(4, max((len(s) for line in lines[start-1:end] for s in line.split() if set(s) == {"`"}), default=0) + 1)
    return fence + "text\n" + "\n".join(f"{n}: {lines[n-1]}" for n in range(start, end + 1)) + "\n" + fence


def expression(node):
    return ast.unparse(node) if node is not None else "None"


def location(path, node):
    return f"{path}:{node.lineno}-{node.end_lineno}"


def own_nodes(node):
    """Walk this function's statements without attributing nested bodies to it."""
    children = node.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else ast.iter_child_nodes(node)
    for child in children:
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        yield child
        yield from own_nodes(child)


def scan_python(path, text):
    tree = ast.parse(text, filename=path)
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    functions = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        scope = []
        parent = parents.get(node)
        while parent:
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                scope.append(parent.name)
            parent = parents.get(parent)
        name = node.name if hasattr(node, "name") else f"lambda@{node.lineno}:{node.col_offset}"
        qualified = ".".join([*reversed(scope), name])
        functions.append(dict(path=path, name=qualified, node=node, parents=parents,
                              calls=[n for n in own_nodes(node) if isinstance(n, ast.Call)]))
    return tree, sorted(functions, key=lambda item: (item["node"].lineno, item["node"].col_offset))


def layer_hint(path):
    parts = set(Path(path).parts)
    hints = []
    for layer, words in {
        "domain": {"domain", "entities", "models", "value_objects"},
        "business": {"services", "use_cases", "usecases", "business", "agents"},
        "data": {"repositories", "persistence", "database", "data", "storage", "dao"},
        "application": {"app", "api", "routers", "controllers", "views", "components"},
    }.items():
        if parts & words:
            hints.append(layer)
    return ", ".join(hints) or "unclassified"


def new_page(key, title, content, paths, kind="static"):
    return WikiPage(id=page_id(key), title=title, content=content,
                    filePaths=list(dict.fromkeys(paths)), importance="high", relatedPages=[],
                    referenceKind=kind)


def build_reference_pages(root, file_tree):
    root = Path(root).resolve()
    sources, trees, functions, coverage, multilingual = {}, {}, [], [], {}
    for path in sorted(set(file_tree)):
        try:
            target = safe_path(root, path)
            if target.stat().st_size > 1_000_000:
                raise ValueError("file exceeds 1 MB documentation limit")
            text = target.read_bytes().decode("utf-8-sig")
            if "\0" in text:
                raise ValueError("binary content")
            sources[path] = text
            if path.endswith(".py"):
                try:
                    tree, found = scan_python(path, text)
                    trees[path] = tree
                    functions.extend(found)
                    coverage.append(f"- `{path}`: {len(found)} Python functions/methods/lambdas inventoried.")
                except (SyntaxError, ValueError, RecursionError) as exc:
                    coverage.append(f"- `{path}`: Python parse failed ({type(exc).__name__}); numbered source only, semantic coverage unverified.")
            else:
                result = scan_language(path, text)
                multilingual[path] = result
                coverage.append(f"- `{path}`: {result['language']}, {result['status']}; {len(result['functions'])} syntax-derived function records. Scope: {result.get('scope', 'supported named syntax constructs')}. Unsupported constructs/dynamic behavior remain unverified.")
        except (OSError, ValueError, UnicodeError) as exc:
            coverage.append(f"- `{path}`: skipped ({exc}).")

    # Resolve only direct same-module or imported module-level function names.
    # Dynamic methods, ambiguous names and re-exports stay explicitly unresolved.
    modules = {p: p.removesuffix(".py").replace("/", ".").removesuffix(".__init__") for p in trees}
    import_links = {p: set() for p in sources}
    for path, tree in trees.items():
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                package = modules[path].split(".") if path.endswith("/__init__.py") else modules[path].split(".")[:-1]
                base = ".".join(package[:len(package) - node.level + 1]) if node.level else ""
                name = ".".join(p for p in (base, node.module) if p)
                names = [name, *(name + "." + a.name for a in node.names)]
            for name in names:
                matches = [p for p, module in modules.items() if module == name or module.endswith("." + name)] if name else []
                if len(matches) == 1 and matches[0] != path:
                    other = matches[0]
                    import_links[path].add(other)
                    import_links[other].add(path)
    symbols = {}
    for f in functions:
        if "." not in f["name"] and not isinstance(f["node"], ast.Lambda):
            symbols.setdefault(modules[f["path"]] + "." + f["name"], []).append(f)
    connections = []
    for path, tree in trees.items():
        aliases = {}
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    aliases[alias.asname or alias.name.split(".")[0]] = alias.name if alias.asname else alias.name.split(".")[0]
            if isinstance(node, ast.ImportFrom):
                package = modules[path].split(".") if path.endswith("/__init__.py") else modules[path].split(".")[:-1]
                base = ".".join(package[:len(package) - node.level + 1]) if node.level else ""
                module = ".".join(p for p in (base, node.module) if p)
                for alias in node.names:
                    aliases[alias.asname or alias.name] = module + "." + alias.name
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        for call in (n for n in ast.walk(tree) if isinstance(n, ast.Call)):
            name = expression(call.func)
            head, *tail = name.split(".")
            key = aliases.get(head, modules[path] + "." + head) + ("." + ".".join(tail) if tail else "")
            matches = symbols.get(key, [])
            target = matches[0] if len(matches) == 1 else None
            consumer = parents.get(call)
            # Include assignment/return around await when available.
            if isinstance(consumer, ast.Await):
                consumer = parents.get(consumer)
            usage = expression(consumer) if isinstance(consumer, (ast.Assign, ast.AnnAssign, ast.Return, ast.Expr)) else "used by enclosing expression"
            connections.append(dict(path=path, node=call, target=target, usage=usage))

    pages = []
    for f in functions:
        path, node, name = f["path"], f["node"], f["name"]
        imports = [n for n in ast.walk(trees[path]) if isinstance(n, (ast.Import, ast.ImportFrom))]
        body = list(own_nodes(node))
        incoming = [c for c in connections if c["target"] is f]
        outgoing = [c for c in connections if c["path"] == path and c["node"] in f["calls"]]
        paths = [path] + [c["path"] for c in incoming] + [c["target"]["path"] for c in outgoing if c["target"]] + sorted(import_links[path])
        header = [f"# Function `{name}`", f"Source: `{location(path, node)}`",
                  f"Layer candidates from path: {layer_hint(path)} (heuristic; verify architectural role).",
                  "## Inputs / values received", f"Signature arguments: `{expression(node.args)}`",
                  "Values shown are declared defaults or source expressions, not observed runtime values.",
                  "## Declared return type", f"`{expression(getattr(node, 'returns', None))}` (None here means no annotation if absent).",
                  "## Purpose / contract", ast.get_docstring(node) or "No docstring; behavior is evidenced by the code below." if not isinstance(node, ast.Lambda) else "Anonymous function; behavior is the returned expression.",
                  "## Returns / yields"]
        returns = [n for n in body if isinstance(n, (ast.Return, ast.Yield, ast.YieldFrom))]
        if isinstance(node, ast.Lambda):
            header.append(f"- `{expression(node.body)}` at `{location(path, node)}`")
        else:
            header.extend(f"- `{expression(n)}` at `{location(path, n)}`" for n in returns)
            header.append("Falling through returns None; generators yield to their consumer, and async calls return an awaitable. Runtime branch/value depends on execution.")
        header += ["## Calls / values passed"]
        for c in outgoing:
            target = c["target"]
            dest = f"candidate `{target['path']}::{target['name']}`" if target else "external/dynamic/unresolved target"
            header.append(f"- `{expression(c['node'])}` at `{location(path, c['node'])}` → {dest}; result consumer: `{c['usage']}`.")
        if not outgoing:
            header.append("No calls in this function's own body.")
        header += ["## Returns to / connected callers (syntactic candidates)",
                   "Bindings may be shadowed, reassigned or dynamically dispatched; these are not runtime guarantees."]
        header.extend(f"- `{location(c['path'], c['node'])}`: `{expression(c['node'])}`; receives result through `{c['usage']}`." for c in incoming)
        if not incoming:
            header.append("No statically resolved caller in the selected repository files. Framework/callback/external consumers are unresolved.")
        header += ["## Try / error / cleanup blocks"]
        for n in body:
            if isinstance(n, (ast.Try, getattr(ast, "TryStar", ast.Try))):
                header.append(f"- try at `{location(path, n)}`; handlers: " + ", ".join(f"{expression(h.type)} as {h.name or '(unnamed)'} at {h.lineno}" for h in n.handlers)
                              + f"; else lines {[x.lineno for x in n.orelse]}; finally lines {[x.lineno for x in n.finalbody]}.")
            elif isinstance(n, (ast.Raise, ast.Assert)):
                header.append(f"- `{expression(n)}` at `{location(path, n)}`")
        if not any(isinstance(n, (ast.Try, getattr(ast, "TryStar", ast.Try), ast.Raise, ast.Assert)) for n in body):
            header.append("No explicit try/raise/assert block in this function; errors from calls can propagate.")
        header += ["## Imports (file scope and nested scopes; see line locations)"]
        header.extend(f"- `{expression(n)}` at `{location(path, n)}`" for n in imports)
        header.append("Connected import/importer files (syntactic candidates): " + ", ".join(f"`{p}`" for p in sorted(import_links[path])))
        header += ["## Numbered implementation"]
        start = min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])
        # Large functions get continuation pages instead of silently truncated code.
        for offset in range(start, node.end_lineno + 1, 100):
            end = min(offset + 99, node.end_lineno)
            content = "\n\n".join(header if offset == start else [f"# Function `{name}` continued", f"Source: `{path}:{offset}-{end}`"])
            content += "\n\n" + snippet(sources[path], offset, end)
            pages.append(new_page(f"{path}:{name}:{node.lineno}:{node.col_offset}:{offset}", f"{path} · {name} · L{offset}-{end}", content, paths))

    # The same contracts and numbered implementations apply across languages.
    symbols = {}
    for path, scan in multilingual.items():
        for function in scan["functions"]:
            symbols.setdefault(function["name"].split(".")[-1], []).append((path, function))
    import re
    for path, scan in multilingual.items():
        for function in scan["functions"]:
            name = function["name"]
            simple = name.split(".")[-1]
            incoming = [(p, call) for p, other in multilingual.items() for call in other["calls"]
                        if re.search(r"(?<![\w])" + re.escape(simple) + r"\s*\(", call["text"])
                        and len(symbols.get(simple, [])) == 1]
            connected = [p for p, _ in incoming]
            outgoing = []
            for call in function["calls"]:
                matches = [(key, targets[0]) for key, targets in symbols.items() if len(targets) == 1
                           and re.search(r"(?<![\w])" + re.escape(key) + r"\s*\(", call["text"])]
                connected.extend(target[0] for _, target in matches)
                outgoing.append(f"- `{call['text']}` at {path}:{call['lines']}; consumer `{call['consumer']}`; name candidates: "
                                + (", ".join(f"{target[0]}::{key}" for key, target in matches) or "unresolved/external"))
            header = [f"# Function `{name}`", f"Language: {scan['language']}; parser status: {scan['status']}",
                      f"Source: `{path}:{function['lines'][0]}-{function['lines'][1]}`",
                      f"Layer candidates from path: {layer_hint(path)} (verify architectural role).",
                      "## Inputs / types / defaults", f"Signature: `{function['signature']}`", f"Parameters: `{function['parameters']}`",
                      "Values are source expressions, not observed runtime values.", "## Return type / returns / yields",
                      f"Declared return: `{function['return_type']}`"]
            header.extend(f"- `{r['text']}` at `{path}:{r['lines'][0]}-{r['lines'][1]}`" for r in function["returns"])
            if not function["returns"]:
                header.append(f"No explicit return/yield extracted. Terminal body/expression: `{function['implicit_result']}`. Whether it returns implicitly depends on language semantics; not runtime-verified.")
            header += ["## Calls / values passed / result consumers", *(outgoing or ["No calls extracted; see numbered implementation."]),
                       "## Returns to / connected callers (name candidates, not resolved runtime dispatch)"]
            header.extend(f"- `{p}:{c['lines'][0]}-{c['lines'][1]}`: `{c['text']}`; consumer `{c['consumer']}`" for p, c in incoming)
            header += ["Dynamic dispatch, overloads, callbacks, external consumers and cross-language bridges are unresolved unless explicit evidence is shown.",
                       "## Try / error / cleanup blocks"]
            header.extend(f"- `{n['text']}` at `{path}:{n['lines'][0]}-{n['lines'][1]}`" for n in function["errors"])
            if not function["errors"]:
                header.append("No explicit error/cleanup construct extracted; called functions may propagate errors.")
            header += ["## Imports / includes / dependencies"]
            header.extend(f"- `{n['text']}` at `{path}:{n['lines'][0]}-{n['lines'][1]}`" for n in scan["imports"])
            start, end = function["lines"]
            end = min(end, len(sources[path].splitlines()))
            for offset in range(start, end + 1, 100):
                last = min(end, offset + 99)
                content = "\n\n".join(header if offset == start else [f"# Function `{name}` continued", f"Source: `{path}:{offset}-{last}`"])
                content += "\n\n## Numbered implementation\n\n" + snippet(sources[path], offset, last)
                pages.append(new_page(f"polyglot:{path}:{name}:{start}:{offset}", f"{path} · {name} · L{offset}-{last}", content, [path, *connected]))

    # File-level pages cover imports, module initialization and all non-function
    # code too. Every selected readable line is preserved in a bounded page.
    for path, text in sources.items():
        lines = text.splitlines()
        for start in range(1, max(2, len(lines) + 1), 100):
            end = min(start + 99, len(lines))
            content = f"# File reference `{path}`\n\nSource: `{path}:{start}-{end}`\n\nLayer candidates: {layer_hint(path)} (path heuristic, not verified architecture).\n\n"
            parsed = path in trees or multilingual.get(path, {}).get("status") == "parsed"
            content += "Syntax-derived function entries are available separately; runtime behavior is not verified.\n\n" if parsed else "Parser coverage is incomplete/unsupported; model analysis and numbered evidence follow.\n\n"
            content += "Connected import/importer files (syntactic candidates): " + ", ".join(f"`{p}`" for p in sorted(import_links[path])) + "\n\n"
            content += snippet(text, start, end)
            pages.append(new_page(f"source:{path}:{start}", f"{path} · source L{start}-{end}", content, [path, *sorted(import_links[path])], "static" if parsed else "source"))

    layers = []
    for layer in ("domain", "business", "data", "application"):
        members = [p for p in sources if layer in layer_hint(p).split(", ")]
        layers.append(f"## {layer.title()} layer\nPath-based candidates only; verify responsibilities and dependency direction in code.\n" + ("\n".join(f"- `{p}`" for p in members) or "No path-based candidates found; this layer may be absent or organized differently."))
    total_functions = len(functions) + sum(len(s["functions"]) for s in multilingual.values())
    report = "# Documentation coverage and layers\n\n" + f"{len(sources)} readable files; {total_functions} syntax-derived functions/methods/lambdas inventoried across languages.\n\n"
    report += "Scope follows repository inclusion/exclusion settings. This is static evidence, not executed behavior. Unsupported syntax, semantic coverage and dynamic connections require review.\n\n"
    report += "\n".join(coverage) + "\n\n" + "\n\n".join(layers)
    pages.insert(0, new_page("coverage", "Documentation coverage and layers", report, []))
    return pages


def attach_reference_pages(structure, pages):
    existing = {p.id for p in structure.pages}
    pages = [p for p in pages if p.id not in existing]
    original_pages = list(structure.pages)
    # Structure/progress payloads carry navigation metadata, not duplicated code.
    structure.pages.extend(p.model_copy(update={"content": ""}) for p in pages)
    if not structure.sections:
        structure.sections = [WikiSection(id="overview-pages", title="Overview", pages=[p.id for p in original_pages], subsections=[])]
        structure.rootSections = ["overview-pages"]
    section = WikiSection(id="source-reference", title="Function and source reference", pages=[p.id for p in pages], subsections=[])
    structure.sections = [*(structure.sections or []), section]
    structure.rootSections = [*(structure.rootSections or []), section.id]
    return structure
