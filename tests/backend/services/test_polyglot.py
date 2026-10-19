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


def test_deep_walk_does_not_use_python_recursion():
    from api.services.wiki.polyglot import walk
    class Node:
        type = 'block'
        def __init__(self, children): self.named_children = children
    node = Node([])
    for _ in range(2500): node = Node([node])
    assert len(list(walk(node))) == 2500


def test_native_crash_is_reported_without_killing_parent(tmp_path, monkeypatch):
    import subprocess
    from api.services.wiki import polyglot
    monkeypatch.setenv('DEEPWIKI_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(polyglot.subprocess, 'run', lambda *args, **kwargs:
        subprocess.CompletedProcess(args[0], 3221225477, '', 'Windows fatal exception: access violation'))
    with pytest.raises(RuntimeError, match='backend remains available'):
        polyglot.scan('ui.html', '<script>function run() {}</script>')
    log = next((tmp_path / 'parser-faults').glob('*.log'))
    assert 'ui.html' in log.read_text() and 'access violation' in log.read_text()


def test_parser_timeout_fails_closed(monkeypatch):
    import subprocess
    from api.services.wiki import polyglot
    def timeout(*args, **kwargs): raise subprocess.TimeoutExpired(args[0], 60)
    monkeypatch.setattr(polyglot.subprocess, 'run', timeout)
    with pytest.raises(RuntimeError, match='timed out'):
        polyglot.scan('ui.js', 'function run() {}')


def test_abrupt_worker_exit_is_contained(tmp_path, monkeypatch):
    import subprocess
    import sys
    from api.services.wiki import polyglot
    monkeypatch.setenv('DEEPWIKI_DATA_DIR', str(tmp_path))
    run = subprocess.run
    def terminated_worker(*args, **kwargs):
        return run([sys.executable, '-c', 'import os; os._exit(7)'], **kwargs)
    monkeypatch.setattr(polyglot.subprocess, 'run', terminated_worker)
    with pytest.raises(RuntimeError, match='exit 7'):
        polyglot.scan('ui.js', 'function run() {}')
    assert list((tmp_path / 'parser-faults').glob('*.log'))


def test_large_embedded_script_preserves_function_coverage():
    # Enough temporary native Node wrappers to cross normal cyclic-GC thresholds.
    functions = '\n'.join(f'function f{i}(x) {{ try {{ return save(x); }} catch(e) {{ throw e; }} }}' for i in range(600))
    source = '<html>\n<body>\n<script>\n' + functions + '\n</script>\n<script lang="ts">\nfunction typed(x: string) { return x; }\n</script></body></html>'
    for _ in range(2):
        result = scan('frontend/index.html', source)
        assert result['status'] == 'parsed'
        assert len(result['functions']) == 601
        assert result['functions'][0]['lines'][0] == 4
        assert result['functions'][-1]['name'] == 'typed'
        assert result['functions'][0]['errors']
