"""Persisted upstream retrieval/coverage baseline. No fixture code or LLM execution."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import statistics
import time
from pathlib import Path

os.environ["DO_NOT_TRACK"] = "1"
os.environ["REPOWISE_SKIP_EDITOR_SETUP"] = "1"
os.environ["REPOWISE_NO_SAVE_KEY"] = "1"
from repowise.cli.commands.search_cmd import _run_search
from repowise.core.ingestion import ASTParser, FileTraverser
from repowise.core.ingestion.languages.registry import REGISTRY
from repowise.core.ingestion.parser import failed_query_languages, missing_grammar_languages
from phase1_questions import QUESTIONS

ROOT = Path(__file__).resolve().parents[1]
PIN = "7f84ae07908de40595fc64b3fe3c910123367a1e"
UPSTREAM = ROOT / ".research" / f"repowise-{PIN}"


def main():
    report = {"upstream_commit": PIN, "model_calls": 0, "semantic_retrieval_evaluated": False,
              "human_review": "pending", "repositories": {}, "questions": []}
    repos = {}
    for name in ("itsdangerous", "p-limit"):
        pin = json.loads((ROOT / ".research" / f"{name}-pin.json").read_text(encoding="utf-8-sig"))
        repo = ROOT / ".research" / f"{name}-{pin['commit']}"
        repos[name] = repo
        with sqlite3.connect(repo / ".repowise/wiki.db") as db:
            symbols = db.execute("select file_path, name, start_line, end_line from wiki_symbols").fetchall()
            counts = {t: db.execute(f"select count(*) from {t}").fetchone()[0]
                      for t in ("wiki_symbols", "wiki_pages", "graph_nodes", "graph_edges", "page_fts")}
            cross_edges = db.execute("select * from graph_edges limit 1").description
            edge_columns = [d[0] for d in cross_edges]
            rows = [dict(zip(edge_columns, r)) for r in db.execute("select * from graph_edges")]
        invalid_spans = []
        for path, symbol, start, end in symbols:
            source = repo / path
            if not source.is_file() or not (1 <= start <= end <= len(source.read_text(encoding="utf-8").splitlines())):
                invalid_spans.append([path, symbol, start, end])
        inventory = []
        parser = ASTParser()
        traversed = {fi.path: fi for fi in FileTraverser(repo).traverse()}
        for path in sorted(repo.rglob("*")):
            if not path.is_file() or ".repowise" in path.relative_to(repo).parts:
                continue
            rel = path.relative_to(repo).as_posix()
            raw = path.read_bytes()
            item = {"path": rel, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
            fi = traversed.get(rel)
            if fi is None:
                item.update(status="excluded", reason="not yielded by upstream traversal")
            else:
                spec = REGISTRY.get(fi.language)
                result = parser.parse_file(fi, raw)
                item.update(language=fi.language, symbols=len(result.symbols), errors=result.parse_errors)
                item["status"] = ("failed" if result.parse_errors else
                                  "unsupported" if spec and spec.is_code and not spec.is_infra and spec.is_passthrough else
                                  "document-only" if spec and spec.is_passthrough else "parsed")
            inventory.append(item)
        report["repositories"][name] = {"pin": pin, "database_counts": counts,
            "invalid_symbol_spans": invalid_spans, "inventory": inventory, "edge_sample": rows[:5],
            "index_scope": "complete downloaded release archive; upstream Git history not included"}

    for i, (name, category, question, query, mode, path, anchor, answer) in enumerate(QUESTIONS, 1):
        repo = repos[name]
        evidence = None
        if path:
            lines = (repo / path).read_text(encoding="utf-8").splitlines()
            matches = [n for n, line in enumerate(lines, 1) if anchor in line]
            if not matches:
                raise ValueError(f"Invalid question anchor {i}: {path}: {anchor}")
            evidence = {"path": path, "anchor_lines": matches, "commit": report["repositories"][name]["pin"]["commit"]}
        started = time.perf_counter()
        result = _run_search(repo, query, 10, mode)
        elapsed = (time.perf_counter() - started) * 1000
        hits = result.get("results", [])
        matched = [hit for hit in hits if path and path in (hit.get("file"), hit.get("path"), hit.get("target_path"))]
        span_hit = any(h.get("start_line", 0) <= n <= h.get("end_line", -1)
                       for h in matched for n in (evidence or {}).get("anchor_lines", []))
        report["questions"].append({"id": f"Q{i:02}", "repository": name, "category": category,
            "question": question, "retrieval_query": query, "mode": mode, "expected_facts": answer,
            "expected_evidence": evidence, "latency_ms": round(elapsed, 2),
            "expected_file_in_top10": bool(matched) if path else None,
            "anchor_in_returned_symbol_span": span_hit if path and mode == "symbol" else None,
            "empty_for_absent_symbol": not hits if not path else None,
            "error": result.get("error"), "results": hits})
        print(f"Q{i:02} complete", flush=True)

    tags = sorted(REGISTRY.code_languages())
    report["language_capabilities"] = {"registered_code_tags": tags,
        "missing_grammar_packages": missing_grammar_languages(tags),
        "query_compile_failures": failed_query_languages(tags),
        "passthrough_tags": sorted(REGISTRY.passthrough_languages()),
        "note": "Grammar/query checks are availability checks, not semantic accuracy claims."}
    questions = report["questions"]
    positives = [q for q in questions if q["expected_evidence"]]
    negatives = [q for q in questions if not q["expected_evidence"]]
    times = sorted(q["latency_ms"] for q in questions)
    report["summary"] = {"questions": len(questions), "positive_cases": len(positives),
        "expected_file_hits_at_10": sum(q["expected_file_in_top10"] for q in positives),
        "symbol_anchor_hits": sum(q["anchor_in_returned_symbol_span"] is True for q in positives),
        "negative_cases": len(negatives), "empty_negative_results": sum(q["empty_for_absent_symbol"] for q in negatives),
        "errors": sum(bool(q["error"]) for q in questions),
        "latency_p50_ms": statistics.median(times), "latency_p95_ms": times[int(.95*(len(times)-1))],
        "limitations": "Analyst-supplied queries; file/anchor retrieval metrics, not end-to-end answer correctness or calibrated abstention. One sequential local run."}
    output = ROOT / "validation/phase1-evaluation-results.json"
    output.write_text(json.dumps(report, indent=2, default=str)+"\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
