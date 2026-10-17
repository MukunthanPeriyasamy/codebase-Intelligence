"""Versioned, deterministic documentation profiles. Never executes repository code.

Confirmed means explicit syntactic signals, not verified runtime architecture.
Unsupported frameworks retain the common source-reference requirements.
"""
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tomllib

import yaml

from api.services.source_files import safe_path
from api.services.wiki.reference import new_page, snippet

RULE_VERSION = 1
COMMON = ["Entry points and configuration", "Functions, inputs, outputs and callers",
          "Imports, dependencies and source ranges", "Errors, cleanup and unresolved relationships"]
REQUIREMENTS = {
    "flutter": ["Widget hierarchy and navigation", "State management and lifecycle", "Theme tokens and active light/dark wiring", "Assets and platform integrations"],
    "react": ["Components and routes", "State and effects", "Styles and design tokens", "API clients and server/browser boundaries"],
    "nextjs": ["App/pages routes and layouts", "Server/client boundaries and actions", "Loading, caching and error handling"],
    "fastapi": ["Application and router registration", "Endpoint input/output contracts", "Authentication and dependencies", "Services, errors and background work"],
    "ai": ["Model providers and call sites", "Prompt construction and context", "Model settings and output validation", "Retries, timeouts and failure handling"],
    "rag": ["Ingestion and chunking", "Embedding configuration and storage", "Retrieval and context assembly", "Citations, filtering and retrieval failure handling"],
    "database": ["Models, tables and relationships", "Queries and migrations", "Transactions, indexes and constraints"],
}
# Imported symbols and use-site patterns are deliberately separate signals.
RULES = {
    "flutter": (r"flutter", r"package:flutter/", r"\b(?:runApp|MaterialApp|CupertinoApp)\s*\("),
    "react": (r"react", r"(?:from\s*['\"]react['\"]|require\(['\"]react['\"]\))", r"\b(?:useState|useEffect|createElement)\s*\(|return\s*\(?\s*<"),
    "nextjs": (r"next", r"(?:from\s*['\"]next(?:/|['\"]))", r"\b(?:NextResponse|NextRequest)\b|<(?:Link|Image)\b"),
    "fastapi": (r"fastapi", r"\bfastapi\b", r"\bFastAPI\s*\("),
    "ai": (r"(?:openai|groq|google-genai|google-generativeai|ollama|anthropic|transformers)", r"\b(?:openai|groq|google\.genai|google\.generativeai|ollama|anthropic|transformers)\b", r"\.(?:generate_content|generate|chat|complete|create|invoke)\s*\("),
    "database": (r"(?:sqlalchemy|sqlmodel|prisma|psycopg|supabase|mongoose|drizzle-orm)", r"\b(?:sqlalchemy|sqlmodel|prisma|psycopg|supabase|mongoose)\b", r"\b(?:create_engine|SQLModel|create_client|PrismaClient)\s*\(|\.(?:execute|query|table)\s*\("),
}
MANIFESTS = {"package.json", "pubspec.yaml", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts"}
GENERATED = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".next", "dist", "build", "graphify-out", ".dart_tool"}


def dependencies(path, text):
    name = PurePosixPath(path).name
    if name == "package.json":
        data = json.loads(text)
        return sorted(set().union(*(set(data.get(k, {})) for k in ("dependencies", "devDependencies", "peerDependencies"))))
    if name == "pubspec.yaml":
        data = yaml.safe_load(text) or {}
        return sorted(set(data.get("dependencies", {})) | set(data.get("dev_dependencies", {})))
    if name == "pyproject.toml":
        data = tomllib.loads(text)
        values = data.get("project", {}).get("dependencies", [])
        values += list(data.get("tool", {}).get("poetry", {}).get("dependencies", {}))
    elif name == "requirements.txt":
        values = [s.strip() for s in text.splitlines() if s.strip() and not s.lstrip().startswith(("#", "-"))]
    else:
        return []
    return sorted({re.split(r"[\s\[<>=!~;]", str(v))[0].lower() for v in values})


def inspect_repository(root, file_tree):
    root = Path(root).resolve()
    sources, inventory, manifests = {}, [], {}
    for path in sorted(set(file_tree)):
        entry = {"path": path}
        try:
            if set(PurePosixPath(path).parts) & GENERATED:
                entry["status"] = "excluded_generated"
                continue
            target = safe_path(root, path)
            if target.stat().st_size > 1_000_000:
                raise ValueError("over_1mb")
            text = target.read_bytes().decode("utf-8-sig")
            if "\0" in text:
                raise ValueError("binary")
            sources[path] = text
            entry.update(status="readable", sha256=hashlib.sha256(text.encode()).hexdigest())
            if PurePosixPath(path).name in MANIFESTS:
                try:
                    manifests[path] = dependencies(path, text)
                except (ValueError, TypeError, AttributeError, yaml.YAMLError):
                    manifests[path] = []
                    entry["manifest_error"] = "unsupported_or_invalid_manifest"
        except (OSError, UnicodeError, ValueError) as exc:
            entry.update(status="unreadable", reason=type(exc).__name__ + ": " + str(exc))
        finally:
            inventory.append(entry)
    if not sources:
        raise ValueError("Documentation coverage failed: zero readable files. Check checkout location and inclusion/exclusion filters.")
    # Audit omitted paths without reading excluded content or following links.
    selected = set(file_tree)
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            target = Path(directory) / name
            if name in GENERATED or target.is_symlink() or (hasattr(target, "is_junction") and target.is_junction()):
                dirs.remove(name)
                path = target.relative_to(root).as_posix()
                if path not in selected:
                    inventory.append(dict(path=path + "/", status="excluded_directory"))
        for name in files:
            path = (Path(directory) / name).relative_to(root).as_posix()
            if path not in selected:
                inventory.append(dict(path=path, status="excluded_by_repository_filters"))
    inventory.sort(key=lambda entry: entry["path"])
    roots = sorted({str(PurePosixPath(p).parent) for p in manifests} | {"."})
    def scope(path):
        return max((r for r in roots if r == "." or path.startswith(r + "/")), key=len)
    components = []
    for component in roots:
        local = {p: t for p, t in sources.items() if scope(p) == component}
        if not local:
            continue
        profiles = []
        for name, (dependency, import_pattern, usage_pattern) in RULES.items():
            evidence = []
            for path, text in local.items():
                if path in manifests:
                    for dep in manifests[path]:
                        if re.fullmatch(dependency, dep):
                            line = next((i for i, s in enumerate(text.splitlines(), 1) if dep in s), 1)
                            evidence.append(dict(file=path, line=line, signal="dependency"))
                    continue
                if PurePosixPath(path).suffix not in {".py", ".dart", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".sql"}:
                    continue
                if path.endswith(".py"):
                    try:
                        tree = ast.parse(text)
                    except (SyntaxError, ValueError, RecursionError):
                        continue
                    imports = [(n.lineno, ast.unparse(n)) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
                    calls = [(n.lineno, ast.unparse(n)) for n in ast.walk(tree) if isinstance(n, ast.Call)]
                else:
                    clean = re.sub(r"/\*[\s\S]*?\*/", lambda m: "\n" * m[0].count("\n"), text)
                    lines = [(i, s) for i, s in enumerate(clean.splitlines(), 1) if not s.lstrip().startswith(("//", "#"))]
                    imports = [(i, s) for i, s in lines if re.search(r"\b(import|from|require)\b", s)]
                    calls = lines
                for kind, pattern, values in (("import", import_pattern, imports), ("usage", usage_pattern, calls)):
                    hits = [(i, s) for i, s in values if re.search(pattern, s)]
                    if hits:
                        evidence.append(dict(file=path, line=hits[0][0], signal=kind))
            signals = {e["signal"] for e in evidence}
            # A generic method call alone is never a profile signal.
            if not signals & {"dependency", "import"}:
                continue
            active_files = {e["file"] for e in evidence if e["signal"] == "import"} & {e["file"] for e in evidence if e["signal"] == "usage"}
            profiles.append(dict(name=name, status="confirmed" if active_files else "candidate", evidence=evidence,
                                 requirements=REQUIREMENTS[name]))
        # RAG requires all three distinct source capabilities, never just an AI dependency.
        rag = []
        for signal, pattern in {"embedding": r"\.(?:embed|embed_query|embed_documents|encode)\s*\(",
                                "retrieval": r"\.(?:similarity_search|retrieve|query_points|search)\s*\(",
                                "context_assembly": r"\b(?:context|retrieved_context)\s*=.*(?:join\(|format\(|f['\"])"}.items():
            for path, text in local.items():
                if PurePosixPath(path).suffix not in {".py", ".ts", ".js", ".dart"}:
                    continue
                for line, value in enumerate(text.splitlines(), 1):
                    if not value.lstrip().startswith(("#", "//")) and re.search(pattern, value):
                        rag.append(dict(file=path, line=line, signal=signal))
                        break
        if rag and any(p["name"] == "ai" for p in profiles):
            profiles.append(dict(name="rag", status="candidate", evidence=rag, requirements=REQUIREMENTS["rag"]))
            # Connections between these calls remain unresolved: do not assert an active RAG pipeline.
        components.append(dict(root=component, profiles=profiles, status="classified" if profiles else "unknown"))
    fingerprint = hashlib.sha256(json.dumps([RULE_VERSION, inventory], sort_keys=True).encode()).hexdigest()
    return dict(rule_version=RULE_VERSION, fingerprint=fingerprint, inventory=inventory,
                components=components, common_requirements=COMMON,
                scope="Selected files after repository filters; generated directories excluded. Confirmed profiles establish syntax signals, not runtime execution."), sources


def requirements_prompt(report):
    if not report:
        return ""
    records = [{"root": c["root"], "profiles": [{"name": p["name"], "status": p["status"],
                "requirements": p["requirements"]} for p in c["profiles"]]} for c in report["components"]]
    return "\nDocumentation requirements (evidence required; candidate profiles need verification):\n" + json.dumps({"common": COMMON, "components": records}) + "\nMark missing evidence explicitly. Do not invent architecture, placeholder implementations or relationships."


def profile_pages(report, sources):
    pages = [new_page("application-profiles", "Application profiles and documentation requirements",
                      "# Deterministic detection report\n\n```json\n" + json.dumps(report, indent=2) + "\n```", [])]
    for component in report["components"]:
        for profile in component["profiles"]:
            title = f"{component['root']} · {profile['name']} · {profile['status']}"
            header = ["# " + title, "Syntactic evidence only; runtime activation and cross-file connections require verification.",
                      "## Required documentation", *["- " + r for r in profile["requirements"]]]
            # Separate evidence pages bound prompts while retaining every detected signal.
            for index, evidence in enumerate(profile["evidence"]):
                path, line = evidence["file"], evidence["line"]
                end = min(len(sources[path].splitlines()), line + 20)
                start = max(1, line - 5)
                body = "\n\n".join(header) + f"\n\nSignal: {evidence['signal']}; Source: `{path}:{start}-{end}`\n\n" + snippet(sources[path], start, end)
                pages.append(new_page(f"profile:{component['root']}:{profile['name']}:{index}", title + f" · {path}:{line}", body, [path], "source"))
    return pages
