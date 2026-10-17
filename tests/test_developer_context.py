import json
from types import SimpleNamespace

import pytest

from api.services.developer_intent import resolve_intent
from api.services.answer_validation import validated_answer, INSUFFICIENT, citation_error
from api.services.document_schema import build_schema
from api.services.document_context import retrieve_legacy_documents as retrieve_documents, NoDocumentError
from tests.test_document_first import save_docs, request, repo


def messages(*texts):
    return [SimpleNamespace(role="user", content=text) for text in texts]


@pytest.mark.parametrize("question,concept", [
    ("what is the primary theme ( colour ) of the application?", "frontend.styling.theme"),
    ("main application color", "frontend.styling.theme"),
    ("What is the application's business purpose?", "application.purpose"),
    ("Explain the database model", "databases.models"),
    ("Which AI model performs inference?", "backend.inference"),
    ("How is UI state managed?", "frontend.state"),
    ("Describe API payload validation", "api.contracts"),
])
def test_developer_concepts(question, concept):
    assert resolve_intent(messages(question)).concept == concept


def test_correction_does_not_retrieve_assistant_guess():
    history = messages("What is the primary theme?")
    history.append(SimpleNamespace(role="assistant", content="UPSC quizzes with Groq"))
    history += messages("No, I mean its colour")
    intent = resolve_intent(history)
    assert intent.correction and intent.concept == "frontend.styling.theme"
    assert "Groq" not in intent.query
    assert resolve_intent(messages("What is the UI theme?", "No, I mean its purpose")).concept == "application.purpose"


def test_schema_indexes_declarative_theme_in_any_language():
    for path in ("lib/theme.dart", "Theme.swift", "theme.css", "theme.kt"):
        schema = build_schema({"theme": {"title": "Settings", "filePaths": [path],
            "content": "Primary color palette and background configuration"}})
        assert "frontend.styling.theme" in schema["pages"]["theme"]["concepts"]


def test_hybrid_retrieval_uses_document_text_only(repo, monkeypatch):
    save_docs(repo, content="Primary color palette: red; theme.py:1")
    seen = []
    def scores(query, texts):
        seen.extend(texts)
        return [0.9] * len(texts)
    monkeypatch.setattr("api.services.document_context.semantic_scores", scores)
    evidence = retrieve_documents(request(repo), "colour")
    assert evidence.chunks[0]["retrieval_score"] > 0
    assert seen and all("color = 'red'" not in t for t in seen)


def test_absent_docs_do_not_embed(repo, monkeypatch):
    monkeypatch.setattr("api.services.document_context.semantic_scores", lambda *a: pytest.fail("No embeddings without documents"))
    with pytest.raises(NoDocumentError):
        retrieve_documents(request(repo), "colour")


@pytest.mark.asyncio
async def test_irrelevant_answer_is_retried_before_display():
    outputs = iter(["It generates quizzes. `theme.py:1`", '{"relevant":false,"grounded":false}',
                    "Primary colour is red. `theme.py:1`", '{"relevant":true,"grounded":true}'])
    class Streamer:
        async def respond_stream(self, prompt):
            yield next(outputs)
    intent = resolve_intent(messages("primary colour"))
    result = [p async for p in validated_answer(Streamer(), "evidence", intent, {"theme.py": "color = 'red'"}, "ollama")]
    assert result == ["Primary colour is red. `theme.py:1`"]


@pytest.mark.asyncio
async def test_invalid_citations_never_reach_user():
    class Streamer:
        async def respond_stream(self, prompt):
            yield "Blue. `unknown.ts:100`"
    result = [p async for p in validated_answer(Streamer(), "", resolve_intent(messages("colour")), {"theme.py": "red"}, "ollama")]
    assert result == [INSUFFICIENT]
    assert citation_error("Red `theme.py:2`", {"theme.py": "red"})


@pytest.mark.asyncio
async def test_clarification_can_pass_without_inventing_citations():
    outputs = iter(["Do you mean the data model or the AI model?",
                    '{"relevant":true,"grounded":true,"kind":"clarification"}'])
    class Streamer:
        async def respond_stream(self, prompt):
            yield next(outputs)
    result = [p async for p in validated_answer(Streamer(), "", resolve_intent(messages("Which model?")), {}, "ollama")]
    assert result == ["Do you mean the data model or the AI model?"]


def test_source_excerpt_prioritizes_matching_lines_and_rejects_omitted_citations():
    from api.services.document_context import focused_source, DocumentEvidence
    source = "\n".join(["unrelated"] * 250 + ["primaryColor = 'blue'"])
    section, admitted = focused_source("theme.ts", source, DocumentEvidence([]), "primary color")
    assert "251: primaryColor" in section
    assert citation_error("Blue `theme.ts:1`", {"theme.ts": source}, {"theme.ts": admitted})
    assert citation_error("Blue `theme.ts:251`", {"theme.ts": source}, {"theme.ts": admitted}) is None


def test_semantic_candidate_can_match_without_lexical_overlap(repo, monkeypatch):
    save_docs(repo, title="Chromatic settings", content="Tint selection", files=["paint.ts"])
    monkeypatch.setattr("api.services.document_context.semantic_scores", lambda query, texts: [.8] * len(texts))
    assert retrieve_documents(request(repo), "colour").paths == ["paint.ts"]


def test_embedding_cache_and_provider_failure(monkeypatch):
    from api.services import document_vectors as vectors
    vectors._cache.clear()
    calls = []
    def embed(*, input):
        calls.append(input)
        return SimpleNamespace(data=[SimpleNamespace(embedding=[1., 0.]) for _ in input], error=None)
    monkeypatch.setattr("api.config.get_embedder", lambda: embed)
    assert vectors.semantic_scores("question", ["document"]) == [1.]
    assert vectors.semantic_scores("question", ["document"]) == [1.]
    assert len(calls) == 1
    def broken(*args, **kwargs):
        raise RuntimeError("unavailable")
    monkeypatch.setattr("api.config.get_embedder", broken)
    assert vectors.semantic_scores("new question", ["document"]) is None
    vectors._cache.clear()
