import asyncio
import pytest
from api.services import retries


@pytest.mark.asyncio
async def test_partial_stream_discarded_and_fresh_streamer(monkeypatch):
    async def sleep(_): pass
    monkeypatch.setattr(asyncio, 'sleep', sleep)
    calls = []
    class Stream:
        async def respond_stream(self, prompt):
            calls.append(1)
            if len(calls) == 1:
                yield 'partial'
                raise ConnectionError('offline')
            yield 'complete'
    assert await retries.collect_model(Stream, 'prompt', 100) == 'complete'
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_bounded_and_permanent_errors(monkeypatch):
    async def sleep(_): pass
    monkeypatch.setattr(asyncio, 'sleep', sleep)
    calls = []
    async def failing():
        calls.append(1)
        raise TimeoutError()
    with pytest.raises(TimeoutError):
        await retries.retry_async(failing, 'test')
    assert len(calls) == 3
    calls.clear()
    async def invalid():
        calls.append(1)
        raise ValueError('invalid path')
    with pytest.raises(ValueError):
        await retries.retry_async(invalid, 'test')
    assert len(calls) == 1


def test_sync_retries(monkeypatch):
    monkeypatch.setattr(retries.time, 'sleep', lambda _: None)
    calls = []
    def request():
        calls.append(1)
        if len(calls) < 3: raise ConnectionError()
        return 'ok'
    assert retries.retry_sync(request, 'embedding') == 'ok'
    assert len(calls) == 3
