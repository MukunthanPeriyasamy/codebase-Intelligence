import json
import pytest

from api.services.wiki.profiles import inspect_repository, profile_pages, requirements_prompt
from api.services.wiki.reference import build_reference_pages
from api.services.wiki.structure import read_repo_file_tree


def write(root, files):
    for path, text in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return list(files)


def test_mixed_profiles_scoped_and_auditable(tmp_path):
    paths = write(tmp_path, {
        "mobile/pubspec.yaml": "dependencies:\n  flutter:\n    sdk: flutter\n",
        "mobile/lib/main.dart": "import 'package:flutter/material.dart';\nvoid main() { runApp(MaterialApp()); }",
        "server/requirements.txt": "fastapi\ngroq\n",
        "server/main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    })
    report, sources = inspect_repository(tmp_path, paths)
    components = {c["root"]: {p["name"]: p for p in c["profiles"]} for c in report["components"]}
    assert components["mobile"]["flutter"]["status"] == "confirmed"
    assert components["server"]["fastapi"]["status"] == "confirmed"
    assert components["server"]["ai"]["status"] == "candidate"
    assert "rag" not in components["server"]
    assert all(e["line"] > 0 for c in components.values() for p in c.values() for e in p["evidence"])
    assert "Theme tokens" in requirements_prompt(report)
    assert any(p.referenceKind == "source" for p in profile_pages(report, sources))
    assert report == inspect_repository(tmp_path, paths[::-1])[0]
    (tmp_path / "server/main.py").write_text("from fastapi import FastAPI\n")
    assert inspect_repository(tmp_path, paths)[0]["fingerprint"] != report["fingerprint"]


def test_comments_do_not_confirm_python_profile(tmp_path):
    paths = write(tmp_path, {"requirements.txt": "fastapi", "a.py": "# from fastapi import FastAPI\n# app = FastAPI()"})
    report, _ = inspect_repository(tmp_path, paths)
    assert report["components"][0]["profiles"][0]["status"] == "candidate"


def test_unknown_language_keeps_common_requirements(tmp_path):
    paths = write(tmp_path, {"main.custom": "custom language source"})
    report, sources = inspect_repository(tmp_path, paths)
    assert report["components"][0]["status"] == "unknown"
    assert report["common_requirements"] and sources


def test_bad_manifest_and_generated_files_are_reported(tmp_path):
    paths = write(tmp_path, {"package.json": "{broken", "main.ts": "export const x = 1;", "graphify-out/cache.json": "{}"})
    report, sources = inspect_repository(tmp_path, paths)
    assert "graphify-out/cache.json" not in sources
    assert any(e.get("manifest_error") for e in report["inventory"])
    assert any(e["status"] == "excluded_generated" for e in report["inventory"])


def test_zero_coverage_fails(tmp_path):
    with pytest.raises(ValueError, match="zero readable"):
        inspect_repository(tmp_path, [])
    with pytest.raises(ValueError, match="zero readable"):
        build_reference_pages(tmp_path, [])


def test_parent_directory_does_not_exclude_entire_checkout(tmp_path, monkeypatch):
    from api.config import configs
    root = tmp_path / "tmp" / "repo"
    write(root, {"main.py": "print('ok')", "tmp/ignored.py": "print('ignored')"})
    monkeypatch.setitem(configs, "file_filters", {"excluded_dirs": ["./tmp/"], "excluded_files": []})
    paths, _ = read_repo_file_tree(str(root))
    assert paths == ["main.py"]


@pytest.mark.asyncio
async def test_cached_profile_invalidates_after_source_changes(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from api.services.wiki import tasks
    from api.schemas import WikiTaskRequest
    paths = write(tmp_path, {"main.py": "def run():\n    return 1\n"})
    report, _ = inspect_repository(tmp_path, paths)
    async def cached(*args):
        return SimpleNamespace(documentation_profiles=report)
    monkeypatch.setattr(tasks, "read_wiki_cache", cached)
    monkeypatch.setattr(tasks, "Repo", lambda *a, **kw: SimpleNamespace(save_path=str(tmp_path)))
    task = tasks.WikiTask.from_wiki_request(WikiTaskRequest(owner="local", repo="sample", type="local", repo_url=str(tmp_path)))
    assert await tasks.profiles_current(task)
    (tmp_path / "main.py").write_text("def run():\n    return 2\n")
    assert not await tasks.profiles_current(task)


@pytest.mark.asyncio
async def test_narrative_receives_only_declared_file(tmp_path, monkeypatch):
    from api.services.wiki import tasks
    from api.schemas import WikiTaskRequest, WikiPage
    paths = write(tmp_path, {"ui.py": "primary_colour = 'blue'\n", "server.py": "unrelated_backend = 'private'\n"})
    report, _ = inspect_repository(tmp_path, paths)
    task = tasks.WikiTask.from_wiki_request(WikiTaskRequest(owner="local", repo="sample", type="local", repo_url=str(tmp_path)))
    task.documentation_profiles = report
    task.reference_pages = {p.id: p for p in build_reference_pages(tmp_path, paths)}
    prompts = []
    class Streamer:
        async def respond_stream(self, prompt):
            prompts.append(prompt)
            yield "Colour definition is blue. `ui.py:1`"
    monkeypatch.setattr(tasks.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(tasks, "get_model_config", lambda *a: {"model_kwargs": {"num_ctx": 32000}})
    page = WikiPage(id="ui", title="Theme", content="", filePaths=["ui.py"], importance="high", relatedPages=[])
    output = await tasks._generate_page(task, page)
    assert "primary_colour" in prompts[0] and "unrelated_backend" not in prompts[0]
    assert output.filePaths == ["ui.py"]


@pytest.mark.asyncio
async def test_incomplete_profile_generation_is_not_published(monkeypatch):
    from api.services.wiki import tasks
    from api.schemas import WikiTaskRequest, WikiStructureModel, WikiPage, TaskStatus
    task = tasks.WikiTask.from_wiki_request(WikiTaskRequest(owner="o", repo="r", type="github", repo_url="https://github.com/o/r"))
    monkeypatch.setattr(tasks, "repo_index_exist", lambda *a: True)
    async def structure(task):
        task.documentation_profiles = {"rule_version": 1}
        return WikiStructureModel(id="wiki", title="Wiki", description="", pages=[])
    async def pages(*args):
        task.incomplete_page_ids.append("bad")
        return {"bad": WikiPage(id="bad", title="Failed page", content="Analysis incomplete: model failed", filePaths=[], importance="high", relatedPages=[])}
    async def forbidden(*args):
        pytest.fail("Incomplete wiki must not be published")
    monkeypatch.setattr(tasks, "_determine_structure", structure)
    monkeypatch.setattr(tasks, "_generate_pages", pages)
    monkeypatch.setattr(tasks, "_save", forbidden)
    await tasks.generate_repo_wiki(task)
    assert task.status == TaskStatus.FAILED
    assert "not published" in task.error
