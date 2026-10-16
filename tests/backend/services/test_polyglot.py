import pytest
from api.services.wiki.polyglot import scan
from api.services.wiki.reference import build_reference_pages


CASES = [
    ("js", "function run(x) { try { return save(x); } catch(e) { throw e; } }"),
    ("ts", "function run(x: string): string { return save(x); }"),
    ("tsx", "function run(x: string) { return <div>{x}</div>; }"),
    ("jsx", "function run(x) { return <div>{x}</div>; }"),
    ("java", "class C { int run(int x) { return save(x); } }"),
    ("c", "int run(int x) { return save(x); }"),
    ("cpp", "int run(int x) { return save(x); }"),
    ("go", "package main\nfunc run(x int) int { return save(x) }"),
    ("rs", "fn run(x: i32) -> i32 { save(x) }"),
    ("php", "<?php function run($x) { return save($x); }"),
    ("swift", "func run(x: Int) -> Int { return save(x) }"),
    ("cs", "class C { int run(int x) { return save(x); } }"),
    ("kt", "fun run(x: Int): Int { return save(x) }"),
    ("rb", "def run(x)\n save(x)\nend"),
    ("dart", "int run(int x) { return save(x); }"),
    ("scala", "def run(x: Int): Int = save(x)"),
    ("lua", "function run(x) return save(x) end"),
    ("sh", 'run() { echo "$1"; }'),
    ("ps1", "function run($x) { return $x }"),
    ("r", "run <- function(x) { return(x) }"),
    ("ex", "defmodule Sample do\n def run(x), do: save(x)\nend"),
    ("jl", "function run(x)\n return save(x)\nend"),
    ("sql", "CREATE FUNCTION run(x int) RETURNS int AS $$ SELECT x; $$ LANGUAGE SQL;"),
    ("vue", '<script lang="ts">\nfunction run(x: string) { return x; }\n</script><template><div /></template>'),
    ("svelte", '<script>\nfunction run(x) { return x; }\n</script><div />'),
    ("html", '<script>\nfunction run(x) { return x; }\n</script>'),
]


@pytest.mark.parametrize("extension,source", CASES)
def test_multilingual_function_evidence(extension, source, tmp_path):
    path = f"sample.{extension}"
    result = scan(path, source)
    assert result["status"] == "parsed"
    assert len(result["functions"]) == 1, result
    function = result["functions"][0]
    assert function["name"].split(".")[-1] == "run"
    assert 1 <= function["lines"][0] <= function["lines"][1] <= len(source.splitlines())
    assert function["signature"] and function["code"]
    (tmp_path / path).write_text(source, encoding="utf-8")
    pages = build_reference_pages(tmp_path, [path])
    page = next(p for p in pages if p.content.startswith("# Function"))
    for section in ["Inputs", "Return type", "Calls", "connected callers", "error", "Imports", "Numbered implementation"]:
        assert section in page.content
    assert page.filePaths[0] == path


def test_nested_arrow_method_and_exception_details():
    source = 'const outer = x => { const inner = y => save(y); try { return inner(x); } finally { cleanup(); } }; class C { run(x) { return x; } }'
    result = scan("sample.js", source)
    assert {f["name"] for f in result["functions"]} == {"outer", "inner", "C.run"}
    outer = next(f for f in result["functions"] if f["name"] == "outer")
    assert any("finally" in n["text"] for n in outer["errors"])
    assert not any("save(y)" == n["text"] for n in outer["calls"])


def test_unknown_and_invalid_syntax_are_reported():
    assert scan("file.unknown", "arbitrary syntax")["status"] == "unsupported"
    assert scan("file.ts", "function broken( {")["status"].startswith("partial")


def test_documented_cross_file_call_candidates(tmp_path):
    (tmp_path / "worker.ts").write_text("export function save(x: string) { return x; }")
    (tmp_path / "api.ts").write_text("import {save} from './worker'; export function run(x: string) { const result = save(x); return result; }")
    pages = build_reference_pages(tmp_path, ["worker.ts", "api.ts"])
    page = next(p for p in pages if "worker.ts · save" in p.title)
    assert "api.ts" in page.filePaths
    assert "result = save(x)" in page.content
