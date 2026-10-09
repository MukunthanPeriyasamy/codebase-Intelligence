"""Capability loading, upstream language fixtures and bounded source fallback probes."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import sqlite3
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("smoke", ROOT / "validation/repowise-baseline.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
from repowise.core.ingestion.languages.registry import REGISTRY
from repowise.core.ingestion.parser import _get_language, LANGUAGE_CONFIGS


def main():
    baseline = json.loads((ROOT / "validation/phase1-evaluation-results.json").read_text())
    report = {"upstream_commit": smoke.PIN, "language_matrix": [], "fixture_parses": [], "fallback": [], "cross_file_calls": {}}
    for language in REGISTRY.all_specs():
        # Special-handler/component tags are distinct from tree-sitter grammars.
        loaded = _get_language(language.tag) is not None if language.tag in LANGUAGE_CONFIGS else None
        report["language_matrix"].append({"language": language.tag, "is_code": language.is_code,
            "passthrough": language.is_passthrough, "grammar_package": language.grammar_package,
            "shares_grammar_with": language.shares_grammar_with, "grammar_loaded": loaded,
            "declared_import_support": language.import_support,
            "status": "unsupported-structural" if language.is_code and language.is_passthrough else
                      "grammar-unavailable" if loaded is False else
                      "grammar-loaded-not-accuracy-certified" if loaded else "special-handler-or-document"})
    samples = smoke.UPSTREAM / "tests/fixtures/lang_samples"
    for path in sorted(samples.rglob("*")):
        if not path.is_file() or path.suffix == ".pyc" or "__pycache__" in path.parts:
            continue
        tag = REGISTRY.from_extension(path.suffix)
        if tag == "unknown":
            continue
        result = smoke.parse(path.relative_to(samples).as_posix(), path.read_bytes(), samples)
        report["fixture_parses"].append({"file": path.relative_to(samples).as_posix(), "language": tag,
            "symbols": len(result.symbols), "calls": len(result.calls), "errors": result.parse_errors})
    for name, repo_data in baseline["repositories"].items():
        repo = ROOT / ".research" / f"{name}-{repo_data['pin']['commit']}"
        with sqlite3.connect(repo / ".repowise/wiki.db") as db:
            edges = db.execute("select source_node_id,target_node_id,resolution_origin,call_lines_json from graph_edges where edge_type='calls'").fetchall()
        report["cross_file_calls"][name] = [dict(source=a,target=b,origin=p,call_lines=json.loads(lines))
            for a,b,p,lines in edges if a.split("::")[0] != b.split("::")[0]]
    # Apply a fixed, gold-independent lexical rule to every question, not just misses.
    # This is an adapter feasibility probe; it does not implement the product router.
    for q in baseline["questions"]:
        data = baseline["repositories"][q["repository"]]
        repo = ROOT / ".research" / f"{q['repository']}-{data['pin']['commit']}"
        query = q["retrieval_query"].casefold()
        candidates = []
        started = time.perf_counter()
        for item in data["inventory"]:
            if item["bytes"] > 512000:
                continue
            path = item["path"]
            raw = (repo / path).read_bytes()
            if b"\x00" in raw:
                continue
            try:
                lines = raw.decode("utf-8").splitlines()
            except UnicodeDecodeError:
                continue
            matched = [n for n,line in enumerate(lines,1) if query in line.casefold()]
            exact_path = query in (path.casefold(), Path(path).name.casefold())
            if matched or exact_path:
                candidates.append({"path": path, "line": matched[0] if matched else 1,
                                   "score": 1000 if exact_path else min(len(matched), 100)})
        candidates = sorted(candidates, key=lambda x: (-x["score"], x["path"]))[:10]
        expected = q["expected_evidence"]
        report["fallback"].append({"question_id": q["id"], "candidates": candidates,
            "latency_ms": round((time.perf_counter()-started)*1000, 2),
            "combined_expected_file_hit": bool(q["expected_file_in_top10"] or
                any(c["path"] == expected["path"] for c in candidates)) if expected else None,
            "negative_empty": not candidates if not expected else None})
    report["summary"] = {
        "fixture_files": len(report["fixture_parses"]),
        "fixture_languages": sorted({f["language"] for f in report["fixture_parses"]}),
        "files_with_symbols": sum(bool(f["symbols"]) for f in report["fixture_parses"]),
        "files_with_parse_diagnostics": sum(bool(f["errors"]) for f in report["fixture_parses"]),
        "combined_file_hits": sum(f["combined_expected_file_hit"] is True for f in report["fallback"]),
        "positive_questions": 45,
        "negative_source_empty": sum(f["negative_empty"] is True for f in report["fallback"]),
        "limits": "Lexical candidates are file locations, not complete evidence packets. Upstream fixtures include deliberately malformed inputs. No semantic accuracy score inferred from nonempty output."}
    (ROOT / "validation/phase1-supplement-results.json").write_text(json.dumps(report,indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report["summary"],indent=2))


if __name__ == "__main__":
    main()
