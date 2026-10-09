"""Interrupt a real-repository index after graph persistence, then resume it."""
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


def main():
    source = ROOT / ".research/itsdangerous-096c8d42545d3b68ea21a4f890fb2b2d8979c0bd"
    target = Path(tempfile.mkdtemp(prefix="recovery-", dir=ROOT / ".research")) / "snapshot"
    shutil.copytree(source, target, ignore=shutil.ignore_patterns(".repowise", "__pycache__", ".git"))
    env = {k:v for k,v in os.environ.items() if not k.endswith("API_KEY")}
    env.update(PYTHONIOENCODING="utf-8", DO_NOT_TRACK="1", REPOWISE_SKIP_EDITOR_SETUP="1", REPOWISE_NO_SAVE_KEY="1")
    args = [sys.executable, "-c", "from repowise.cli.main import cli; cli()", "init", str(target),
            "--no-prose", "--provider", "mock", "--embedder", "mock", "--yes", "--no-editor-setup",
            "--no-agents", "--no-codex", "--no-hook", "--no-save-key", "--no-workspace"]
    log = target.parent / "interrupted.log"
    observed = False
    before = 0
    with log.open("wb") as output:
        process = subprocess.Popen(args, env=env, stdout=output, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 180
        while process.poll() is None and time.monotonic() < deadline:
            db_path = target / ".repowise/wiki.db"
            if db_path.is_file():
                try:
                    with sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=.1) as db:
                        before = db.execute("select count(*) from wiki_symbols").fetchone()[0]
                    if before:
                        observed = True
                        process.terminate()
                        break
                except sqlite3.Error:
                    pass
            time.sleep(.1)
        if process.poll() is None and not observed:
            process.terminate()
        code = process.wait(timeout=30)
    print(f"Interrupted after {before} persisted symbols: {observed}", flush=True)
    started = time.perf_counter()
    with (target.parent / "resumed.log").open("wb") as output:
        resumed = subprocess.run(args + ["--resume"], env=env, stdout=output, stderr=subprocess.STDOUT, timeout=240)
    with sqlite3.connect(target / ".repowise/wiki.db") as db:
        integrity = db.execute("pragma integrity_check").fetchone()[0]
        counts = {t: db.execute(f"select count(*) from {t}").fetchone()[0]
                  for t in ("wiki_symbols", "wiki_pages", "graph_edges")}
        duplicate_symbols = db.execute("select symbol_id,count(*) from wiki_symbols group by symbol_id having count(*)>1").fetchall()
    with sqlite3.connect(source / ".repowise/wiki.db") as db:
        reference = {t: db.execute(f"select count(*) from {t}").fetchone()[0] for t in counts}
    report = {"fixture": str(target), "interruption_after_persistence": observed,
        "interrupted_exit": code, "resumed_exit": resumed.returncode, "integrity": integrity,
        "counts": counts, "uninterrupted_reference_counts": reference,
        "duplicate_symbols": duplicate_symbols, "resume_seconds": round(time.perf_counter()-started, 3),
        "passed": observed and resumed.returncode == 0 and integrity == "ok" and not duplicate_symbols and counts == reference,
        "limits": "Abrupt termination after symbol persistence, one small repository; does not prove crash recovery at every write point or product-level job cancellation."}
    (ROOT / "validation/phase1-recovery-results.json").write_text(json.dumps(report,indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report,indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
