"""Parallel MCP graph indexing; failures do not discard generated documents."""
import asyncio
import json
import time
from pathlib import Path
from api.services.kg_mcp import graph
from api.services.retries import retry_async

_build_lock = asyncio.Lock()


def payload(result):
    if result.get('isError'):
        raise RuntimeError('KG tool reported an error. See the MCP log.')
    if result.get('structuredContent'):
        return result['structuredContent']
    for block in result.get('content', []):
        if block.get('type') == 'text':
            return json.loads(block['text'])
    raise ValueError('KG returned no job data')


async def build_graph(task, root):
    async with _build_lock:
        await _build_graph(task, root)


async def _build_graph(task, root):
    stage = next(item for item in task.pipeline if item['id'] == 'kg')
    stage.update(state='active', started_at=int(time.time()*1000), detail='Starting CodeGraphContext MCP and indexing this checkout')
    try:
        async with asyncio.timeout(1800):
            await asyncio.to_thread(graph.allow_workspace, root)
            await retry_async(lambda: asyncio.to_thread(graph.catalog), 'KG connection', on_retry=lambda detail: stage.update(detail=detail))
            result = payload(await asyncio.to_thread(graph.call, 'add_code_to_graph', {'repo_path': Path(root).resolve().as_posix()}, confirmed=True))
            job = result.get('job_id')
            if not job:
                if 'already indexed' in str(result.get('message', '')).lower():
                    stage.update(state='completed', detail='Existing repository graph available (not rebuilt)')
                    return
                raise ValueError('KG did not return an indexing job ID')
            while True:
                status = payload(await retry_async(lambda: asyncio.to_thread(graph.call, 'check_job_status', {'job_id': job}), 'KG status', on_retry=lambda detail: stage.update(detail=detail)))
                if status.get('error') or status.get('status') == 'not_found':
                    raise RuntimeError(str(status.get('error') or 'Indexing job no longer exists'))
                status = status.get('job', status)
                state = status.get('status')
                stage['detail'] = str(status.get('message') or status.get('progress') or state)
                if state == 'completed':
                    stage.update(state='completed', detail='Repository graph ready')
                    break
                if state in ('failed', 'cancelled'):
                    raise RuntimeError(str(status.get('error') or 'KG indexing failed'))
                await asyncio.sleep(2)
    except Exception as exc:
        stage.update(state='failed', detail=f'KG unavailable: {exc}. Documentation/RAG remains independent.')
    finally:
        stage['finished_at'] = int(time.time()*1000)
