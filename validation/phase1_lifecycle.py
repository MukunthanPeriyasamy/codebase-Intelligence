"""Exercise unmodified upstream persistence, update, cache and resume on owned fixtures."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("smoke", ROOT / "validation/repowise-baseline.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
from repowise.core.ingestion import ASTParser, ChangeDetector, FileTraverser, GraphBuilder
from repowise.core.ingestion.parse_cache import ParseCache


def main():
    repo = Path(tempfile.mkdtemp(prefix="lifecycle-", dir=ROOT / ".research"))
    env = os.environ.copy()
    env.update(DO_NOT_TRACK="1", REPOWISE_SKIP_EDITOR_SETUP="1", REPOWISE_NO_SAVE_KEY="1", PYTHONIOENCODING="utf-8")
    # Force keyless providers and prevent inherited provider credentials being used.
    env = {k: v for k, v in env.items() if not k.endswith("API_KEY")}
    command = [sys.executable, "-c", "from repowise.cli.main import cli; cli()"]
    init = ["init", str(repo), "--no-prose", "--provider", "mock", "--embedder", "mock", "--yes",
            "--no-editor-setup", "--no-agents", "--no-codex", "--no-hook", "--no-save-key", "--no-workspace"]
    report = {"fixture": str(repo), "checks": [], "commands": [], "model_calls": 0}

    def check(name, value, detail=None):
        report["checks"].append({"name": name, "passed": bool(value), "detail": detail})

    def run(label, args):
        log = repo.parent / f"{repo.name}-{label}.log"
        started = time.perf_counter()
        with log.open("wb") as output:
            result = subprocess.run(command + args, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=240)
        report["commands"].append({"label": label, "exit_code": result.returncode,
                                   "seconds": round(time.perf_counter()-started, 3), "log": str(log)})
        print(f"{label}: exit {result.returncode}", flush=True)
        if result.returncode:
            print(log.read_text(encoding="utf-8")[-4000:], flush=True)
        return result.returncode == 0

    def read_db(query):
        with sqlite3.connect(repo / ".repowise/wiki.db") as db:
            return db.execute(query).fetchall()

    files = {"helper.py": "def helper(x):\n    return x + 1\n",
             "app.py": "from helper import helper\ndef entry(x):\n    return helper(x)\n",
             "obsolete.py": "def obsolete():\n    return 0\n",
             "rename_me.py": "def retained():\n    return 3\n",
             "config.yaml": "retry_limit: 3\n",
             "unsupported.hs": "helper x = x + 1\n",
             ".gitignore": ".repowise/\n"}
    for name, content in files.items():
        (repo / name).write_text(content, encoding="utf-8")
    smoke.git(repo, "init", "--quiet")
    smoke.git(repo, "add", "--all")
    smoke.git(repo, "commit", "--quiet", "-m", "initial owned fixture")
    base = smoke.git(repo, "rev-parse", "HEAD")
    check("initial-persisted-index", run("init", init))
    old_symbols = read_db("select symbol_id from wiki_symbols")
    check("initial-symbols", ("helper.py::helper",) in old_symbols and ("obsolete.py::obsolete",) in old_symbols)
    calls = read_db("select source_node_id,target_node_id,resolution_origin from graph_edges where edge_type='calls'")
    check("cross-file-call-and-provenance", any(a == "app.py::entry" and b == "helper.py::helper" and p for a,b,p in calls), calls)
    # The index is reopened through sqlite in each read, verifying persisted rather than in-memory results.
    old_pages = read_db("select id,content from wiki_pages")
    check("persisted-structural-pages", bool(old_pages), {"pages": len(old_pages)})

    infos = list(FileTraverser(repo).traverse())
    parsed = [ASTParser().parse_file(fi, Path(fi.abs_path).read_bytes()) for fi in infos]
    builder = GraphBuilder(repo)
    for pf in parsed:
        builder.add_file(pf)
    graph = builder.build()
    cache_dir = repo.parent / f"{repo.name}-cache"
    cache_dir.mkdir()
    cache = ParseCache(cache_dir)
    helper = next(p for p in parsed if p.file_info.path == "helper.py")
    cache.put(helper, helper.content_hash)
    cache.save()
    reopened = ParseCache(cache_dir)
    reopened.load()
    check("persisted-parse-cache-hit", reopened.get(helper.file_info, helper.content_hash) is not None)
    check("changed-hash-cache-miss", reopened.get(helper.file_info, hashlib.sha256(b"changed").hexdigest()) is None)
    # An old snapshot remains readable while a staging index is built by the application.
    # Here only preservation of an independent old DB is probed, not product atomic publication.
    prior_db = repo.parent / f"{repo.name}-prior.db"
    with sqlite3.connect(repo / ".repowise/wiki.db") as source, sqlite3.connect(prior_db) as target:
        source.backup(target)

    (repo / "helper.py").write_text("def helper(x):\n    return x + 2\n", encoding="utf-8")
    (repo / "obsolete.py").unlink()
    (repo / "rename_me.py").rename(repo / "renamed.py")
    (repo / "added.py").write_text("def added():\n    return 42\n", encoding="utf-8")
    smoke.git(repo, "add", "--all")
    smoke.git(repo, "commit", "--quiet", "-m", "add edit rename delete")
    head = smoke.git(repo, "rev-parse", "HEAD")
    detector = ChangeDetector(repo)
    diffs = detector.get_changed_files(base, head)
    affected = detector.get_affected_pages(diffs, graph)
    check("dependent-caller-invalidated", "app.py" in affected.regenerate, affected.__dict__)
    check("incremental-update-exit", run("update", ["update", str(repo), "--since", base, "--provider", "mock", "--no-workspace"]))
    updated = read_db("select symbol_id from wiki_symbols")
    check("added-symbol-indexed", ("added.py::added",) in updated)
    check("deleted-symbol-removed", ("obsolete.py::obsolete",) not in updated)
    check("renamed-symbol-rekeyed", ("renamed.py::retained",) in updated and ("rename_me.py::retained",) not in updated)
    dead_edges = read_db("select source_node_id,target_node_id from graph_edges where source_node_id like 'obsolete.py%' or target_node_id like 'obsolete.py%' or source_node_id like 'rename_me.py%' or target_node_id like 'rename_me.py%'")
    check("deleted-renamed-graph-edges-removed", not dead_edges, dead_edges)
    pages = read_db("select target_path,freshness_status from wiki_pages where target_path in ('obsolete.py','rename_me.py')")
    check("deleted-renamed-pages-tombstoned", all(status == "tombstone" for _,status in pages), pages)
    from repowise.cli.commands.search_cmd import _run_search
    stale = _run_search(repo, "obsolete", 10, "symbol")
    check("deleted-symbol-not-retrievable", not stale.get("error") and not stale.get("results"), stale)
    stale_pages = _run_search(repo, "obsolete", 10, "concept")
    check("tombstoned-pages-not-retrievable", not stale_pages.get("error") and not any(
        h.get("target_path") in ("obsolete.py", "rename_me.py") for h in stale_pages.get("results", [])))
    state = json.loads((repo / ".repowise/state.json").read_text())
    check("indexed-commit-stamped", state.get("last_sync_commit") == head, state.get("last_sync_commit"))
    with sqlite3.connect(prior_db) as db:
        check("independent-prior-index-preserved", db.execute("select count(*) from wiki_symbols where name='obsolete'").fetchone()[0] == 1)
    (repo / "helper.py").write_text("def dirty_only():\n    return 999\n", encoding="utf-8")
    check("same-commit-detector-ignores-dirty-content", not detector.get_changed_files(head, head))
    blob = subprocess.check_output(["git", "show", f"{head}:helper.py"], cwd=repo)
    (repo / "helper.py").write_bytes(blob)
    before = sorted(updated)
    check("resume-command-exit", run("resume", init + ["--resume"]))
    check("resume-does-not-duplicate-symbols", sorted(read_db("select symbol_id from wiki_symbols")) == before)
    check("resume-database-integrity", read_db("pragma integrity_check") == [("ok",)])
    report["commits"] = {"base": base, "head": head}
    report["passed"] = sum(c["passed"] for c in report["checks"])
    report["total"] = len(report["checks"])
    report["limits"] = "Upstream clean-fixture update and completed-run resume; product job cancellation, atomic publication, answer-cache invalidation and provider generation belong to later implementation gates."
    (ROOT / "validation/phase1-lifecycle-results.json").write_text(json.dumps(report, indent=2, default=str)+"\n", encoding="utf-8")
    print(f"{report['passed']}/{report['total']} lifecycle checks passed")
    if report["passed"] != report["total"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
