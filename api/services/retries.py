"""Bounded retries for read/inference operations; never replay filesystem writes."""
import asyncio
import logging
import time
import httpx

logger = logging.getLogger(__name__)


def transient(error):
    if isinstance(error, RuntimeError) and str(error).startswith('KG MCP server stopped.'):
        return True
    status = getattr(error, 'status_code', None)
    if status is None:
        status = getattr(getattr(error, 'response', None), 'status_code', None)
    if status is not None:
        return status in (408, 429, 500, 502, 503, 504)
    return isinstance(error, (TimeoutError, ConnectionError, BrokenPipeError, httpx.TransportError))


async def retry_async(operation, label, attempts=3, on_retry=None):
    for attempt in range(attempts):
        try:
            return await operation()
        except Exception as error:
            if not transient(error) or attempt == attempts - 1:
                raise
            detail = f'{label}: retry {attempt + 2}/{attempts} after {type(error).__name__}'
            logger.warning(detail)
            if on_retry:
                on_retry(detail)
            await asyncio.sleep(2 ** attempt)


def retry_sync(operation, label, attempts=3):
    for attempt in range(attempts):
        try:
            return operation()
        except Exception as error:
            if not transient(error) or attempt == attempts - 1:
                raise
            logger.warning('%s: retry %s/%s after %s', label, attempt + 2, attempts, type(error).__name__)
            time.sleep(2 ** attempt)


async def collect_model(factory, prompt, limit):
    async def collect():
        output = ''
        async for part in factory().respond_stream(prompt):
            output += part
            if len(output) > limit:
                raise ValueError('Model output exceeded the allowed limit; narrow the request.')
        return output
    return await retry_async(collect, 'Model generation')
