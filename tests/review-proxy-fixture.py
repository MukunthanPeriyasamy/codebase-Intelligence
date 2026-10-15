"""Temporary review-only API for the real frontend proxy smoke test; no inference."""
import json
import os
from pathlib import Path
import tempfile

root = Path(tempfile.mkdtemp(prefix="review-proxy-", dir=".local")).resolve()
os.environ["DEEPWIKI_DATA_DIR"] = str(root / "data")
from fastapi import FastAPI
from api.routers.changes import router
from api.services.changes import make_proposal, EditPlan, Edit
import uvicorn

repo = root / "repo"
repo.mkdir()
(repo / "sample.txt").write_bytes(b"before\n")
proposal = make_proposal(repo, EditPlan(summary="Fixture only", edits=[
    Edit(path="sample.txt", old_text="before", new_text="after")
]), {"sample.txt": "before\n"}, str(root / "data/cache.pkl"),
    [{"page_id": "sample", "title": "Sample", "chunk": 1, "files": ["sample.txt"]}])
Path(".local/review-proxy-result.json").write_text(json.dumps(proposal))
app = FastAPI()
app.include_router(router)
uvicorn.run(app, host="127.0.0.1", port=8001)
