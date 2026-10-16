"""Bounded content-addressed document embeddings using the configured provider."""
from collections import OrderedDict
import hashlib
import json
import logging
import math
import os
from threading import Lock

logger = logging.getLogger(__name__)


_cache = OrderedDict()
_lock = Lock()


def vectors(config_key, texts):
    from api.config import get_embedder
    keys = [(config_key, hashlib.sha256(text.encode()).hexdigest()) for text in texts]
    with _lock:
        found = {key: _cache[key] for key in keys if key in _cache}
    missing = list(dict.fromkeys(i for i, key in enumerate(keys) if key not in found))
    embedder = get_embedder() if missing else None
    for offset in range(0, len(missing), 16):
        batch = missing[offset:offset + 16]
        result = embedder(input=[texts[i] for i in batch])
        if getattr(result, "error", None) or len(result.data or []) != len(batch):
            raise ValueError("Embedding provider returned incomplete vectors")
        for i, item in zip(batch, result.data):
            values = tuple(float(v) for v in item.embedding)
            if not values or not all(math.isfinite(v) for v in values):
                raise ValueError("Invalid embedding vector")
            found[keys[i]] = values
    with _lock:
        for key, value in found.items():
            _cache[key] = value
            _cache.move_to_end(key)
        while len(_cache) > 4096:
            _cache.popitem(last=False)
    return [found[key] for key in keys]


def semantic_scores(query, texts):
    from api.config import get_embedder_config, get_embedder_type
    key = json.dumps([get_embedder_type(), get_embedder_config().get("model_kwargs", {}), os.environ.get("OLLAMA_HOST", "")], sort_keys=True)
    try:
        q, *documents = vectors(key, [query, *texts])
        scores = []
        for v in documents:
            if len(q) != len(v):
                raise ValueError("Embedding dimensions differ")
            norm = math.sqrt(sum(x*x for x in q) * sum(x*x for x in v))
            scores.append(sum(a*b for a, b in zip(q, v)) / norm if norm else 0)
        return scores
    except Exception as exc:
        # Keep lexical retrieval available, but make degraded mode observable.
        logger.warning("Document semantic retrieval unavailable (%s); using BM25", type(exc).__name__)
        return None
