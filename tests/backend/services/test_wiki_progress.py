from api.schemas import WikiTaskRequest
from api.services.wiki.tasks import WikiTask


def task():
    return WikiTask.from_wiki_request(WikiTaskRequest(owner="o", repo="r", type="github", repo_url="https://github.com/o/r"))


def test_pipeline_retains_completed_stages_and_serializes():
    t = task()
    assert all(s["state"] == "pending" for s in t.to_status().pipeline)
    for stage in ["repository", "inventory", "profiles", "references", "structure", "pages", "validate", "chunking", "embedding", "vector_store", "save"]:
        t.advance(stage)
    assert t.pipeline[-1]["state"] == "active"
    assert all(s["state"] == "completed" for s in t.pipeline[:-1])
    t.finish_pipeline()
    assert all(s["state"] == "completed" for s in t.to_status().model_dump()["pipeline"])


def test_failure_marks_current_stage_only():
    t = task()
    t.advance("repository")
    t.advance("inventory")
    t.error = "Cannot read checkout"
    t.finish_pipeline(failed=True)
    stages = {s["id"]: s for s in t.to_status().pipeline}
    assert stages["repository"]["state"] == "completed"
    assert stages["inventory"]["state"] == "failed"
    assert stages["inventory"]["detail"] == t.error
    assert stages["profiles"]["state"] == "pending"
