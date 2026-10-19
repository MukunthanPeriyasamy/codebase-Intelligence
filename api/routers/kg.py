"""Explicit KG testing commands, independent of document RAG and editing."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from jsonschema.exceptions import ValidationError
from api.routers.changes import review_request
from api.services.kg_mcp import graph

router = APIRouter(prefix="/kg", tags=["knowledge-graph"], dependencies=[Depends(review_request)])


class ToolCall(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)
    confirmed: bool = False


class GraphQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    provider: str = 'ollama'
    model: str | None = None
    workspace: str | None = None


@router.post('/ask')
async def ask(request: GraphQuestion):
    from api.services.kg_chat import answer
    try:
        return await answer(request.question, request.provider, request.model, request.workspace)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/tools")
def tools():
    try:
        return graph.catalog()
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/call")
def call(request: ToolCall):
    try:
        return graph.call(request.name, request.arguments, request.confirmed)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc
