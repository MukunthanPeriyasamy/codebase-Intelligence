"""No-model smoke baseline against a pinned, unmodified RepoWise source archive.

Run using .research/venv/Scripts/python.exe validation/repowise-baseline.py.
Only creates Git commits inside a fresh synthetic fixture under .research.
This is an integration probe, not the product's production adapter.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = "7f84ae07908de40595fc64b3fe3c910123367a1e"
UPSTREAM = ROOT / ".research" / f"repowise-{PIN}"
sys.path.insert(0, str(UPSTREAM / "packages/core/src"))

from repowise.core.ingestion import ASTParser, ChangeDetector, FileInfo, GraphBuilder
from repowise.core.ingestion.languages.registry import REGISTRY

SAMPLES = {
    "sample.py": "def helper(x):\n    return x + 1\ndef entry(x):\n    return helper(x)\n",
    "sample.ts": "export function helper(x: number) { return x + 1; }\nexport function entry(x: number) { return helper(x); }\n",
    "sample.js": "export function helper(x) { return x + 1; }\nexport function entry(x) { return helper(x); }\n",
    "sample.go": "package sample\nfunc helper(x int) int { return x + 1 }\nfunc entry(x int) int { return helper(x) }\n",
    "sample.rs": "fn helper(x: i32) -> i32 { x + 1 }\nfn entry(x: i32) -> i32 { helper(x) }\n",
    "Sample.java": "class Sample {\n static int helper(int x) { return x + 1; }\n static int entry(int x) { return helper(x); }\n}\n",
    "sample.cpp": "int helper(int x) { return x + 1; }\nint entry(int x) { return helper(x); }\n",
}


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false",
         "-c", "user.name=Baseline Fixture", "-c", "user.email=fixture@example.invalid",
         *args], cwd=repo, text=True, stderr=subprocess.PIPE,
    ).strip()


def parse(path: str, source: bytes, repo: Path):
    info = FileInfo(
        path=path, abs_path=str(repo / path), language=REGISTRY.from_extension(Path(path).suffix),
        size_bytes=len(source), git_hash="", last_modified=datetime(2000, 1, 1, tzinfo=timezone.utc),
        is_test=False, is_config=False, is_api_contract=False, is_entry_point=False,
    )
    return ASTParser().parse_file(info, source)


def main() -> None:
    repo = Path(tempfile.mkdtemp(prefix="baseline-", dir=ROOT / ".research"))
    report = {"upstream_commit": PIN, "upstream_version": "0.55.0",
              "scope": "synthetic parser/graph/change-detector probes; no LLM, full pipeline or performance benchmark",
              "fixture_path": str(repo), "checks": []}

    def check(name: str, passed: bool, detail):
        report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})

    for path, source in SAMPLES.items():
        (repo / path).write_text(source, encoding="utf-8")
        parsed = parse(path, source.encode(), repo)
        names = {s.name for s in parsed.symbols}
        check(f"symbols:{path}", {"helper", "entry"} <= names and not parsed.parse_errors,
              {"symbols": sorted(names), "errors": parsed.parse_errors})
        check(f"spans:{path}", all(1 <= s.start_line <= s.end_line <= len(source.splitlines())
                                  for s in parsed.symbols) and bool(parsed.symbols),
              [{"name": s.name, "start": s.start_line, "end": s.end_line} for s in parsed.symbols])
        builder = GraphBuilder(repo)
        builder.add_file(parsed)
        graph = builder.build()
        calls = [(a, b, data) for a, b, data in graph.edges(data=True) if data.get("edge_type") == "calls"]
        check(f"call:{path}", any(a.endswith("::entry") and b.endswith("::helper") for a, b, _ in calls), calls)

    fallback = parse("sample.hs", b"helper x = x + 1\n", repo)
    report["fallback_probe"] = {"language": fallback.file_info.language,
                                "symbols": len(fallback.symbols), "errors": fallback.parse_errors}
    report["registry"] = {"code_languages": sorted(REGISTRY.code_languages()),
                          "passthrough_languages": sorted(REGISTRY.passthrough_languages())}

    for name in ("rename.py", "delete.py"):
        (repo / name).write_text(f"def {name.split('.')[0]}():\n    return 1\n", encoding="utf-8")
    git(repo, "init", "--quiet")
    git(repo, "add", "--all")
    git(repo, "commit", "--quiet", "-m", "baseline fixture")
    base = git(repo, "rev-parse", "HEAD")
    (repo / "sample.py").write_text(SAMPLES["sample.py"].replace("x + 1", "x + 2"), encoding="utf-8")
    (repo / "added.py").write_text("def added():\n    return 2\n", encoding="utf-8")
    (repo / "rename.py").rename(repo / "renamed.py")
    (repo / "delete.py").unlink()
    git(repo, "add", "--all")
    git(repo, "commit", "--quiet", "-m", "add modify rename delete")
    head = git(repo, "rev-parse", "HEAD")
    detector = ChangeDetector(repo)
    clean = detector.get_changed_files(base, head)
    statuses = {d.path: d.status for d in clean}
    check("commit-diff-statuses", statuses == {"added.py": "added", "delete.py": "deleted",
                                               "renamed.py": "renamed", "sample.py": "modified"}, statuses)
    committed_source = subprocess.check_output(["git", "show", f"{head}:sample.py"], cwd=repo)
    (repo / "sample.py").write_text("def uncommitted_only():\n    return 999\n", encoding="utf-8")
    (repo / "untracked.py").write_text("def untracked(): pass\n", encoding="utf-8")
    dirty = detector.get_changed_files(base, head)
    dirty_names = [s.name for d in dirty if d.path == "sample.py" for s in d.new_parsed.symbols]
    report["known_incompatibility"] = {
        "name": "upstream commit diff reads new content from working tree",
        "reproduced": "uncommitted_only" in dirty_names, "observed_symbols": dirty_names,
        "required_mitigation": "analyze isolated committed snapshots, never the user's mutable checkout",
    }
    check("same-commit-no-update", detector.get_changed_files(head, head) == [], "dirty working tree; HEAD unchanged")
    committed = parse("sample.py", committed_source, repo)
    check("git-blob-isolation", {s.name for s in committed.symbols} == {"helper", "entry"}
          and committed.content_hash == hashlib.sha256(committed_source).hexdigest(),
          {"symbols": [s.name for s in committed.symbols], "hash": committed.content_hash})
    report["fixture_commits"] = {"base": base, "head": head}
    report["passed"] = sum(c["passed"] for c in report["checks"])
    report["total"] = len(report["checks"])
    output = ROOT / "validation" / "repowise-baseline-results.json"
    output.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"{report['passed']}/{report['total']} checks passed; results: {output}")
    if report["passed"] != report["total"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
