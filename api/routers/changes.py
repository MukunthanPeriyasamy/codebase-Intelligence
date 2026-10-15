from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from api.schemas import ChatCompletionRequest
from api.services import changes


def review_request(request: Request):
    # A web page on another origin must not be able to approve local writes.
    origin = request.headers.get("origin")
    if request.headers.get("x-deepwiki-review") != "1" or (origin and origin not in (
        "http://127.0.0.1:3000", "http://localhost:3000"
    )):
        raise HTTPException(403, "Use the local DeepWiki review interface")
    if urlparse(str(request.url)).hostname not in ("127.0.0.1", "localhost", "testserver"):
        raise HTTPException(403, "Code review is only available locally")


router = APIRouter(prefix="/chat/changes", dependencies=[Depends(review_request)])


@router.post("")
async def propose(request: ChatCompletionRequest):
    try:
        return await changes.propose(request)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{proposal_id}")
def get(proposal_id: str):
    try:
        return changes.get_proposal(proposal_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{proposal_id}/{action}")
def decide(proposal_id: str, action: str):
    try:
        return changes.decide(proposal_id, action)
    except (ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc
