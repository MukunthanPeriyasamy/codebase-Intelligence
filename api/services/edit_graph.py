"""Bounded read-only graph expansion anchored in retrieved document symbols."""
import json
from pathlib import Path

from api.services.kg_mcp import graph
from api.services.source_files import safe_path, read_source
from api.services.document_context import terms


def expand(root, evidence, query):
    root = Path(root).resolve()
    sources, traces, warnings = {}, [], []
    anchors = []
    words = set(terms(query))
    for name, record in evidence.file_records.items():
        try:
            safe_path(root, name)
        except ValueError:
            continue
        for symbol in record.get('symbols', []):
            target = symbol.get('name')
            if isinstance(target, str) and target:
                anchors.append((name, target))
    anchors = sorted(set(anchors), key=lambda item: -len(words & set(terms(' '.join(item)))))[:3]
    if not anchors:
        return {}, {'status': 'unavailable', 'traces': [], 'warnings': ['No documented symbols available for graph traversal. Document-only context used.']}

    def records(value):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from records(child)
        elif isinstance(value, list):
            for child in value[:100]:
                yield from records(child)

    try:
        catalog = graph.catalog()
        tool = next(t for t in catalog['tools'] if t['name'] == 'analyze_code_relationships')
        if 'repo_path' not in tool.get('inputSchema', {}).get('properties', {}):
            raise ValueError('KG does not support repository-scoped relationship queries')
        for name, target in anchors:
            for relation in ('find_callers', 'find_callees'):
                result = graph.call('analyze_code_relationships', {
                    'repo_path': root.as_posix(), 'context': safe_path(root, name).as_posix(),
                    'target': target, 'query_type': relation,
                })
                if result.get('isError'):
                    warnings.append(f'KG query failed for {name}:{target} ({relation}).')
                    continue
                payloads = [result.get('structuredContent', {})]
                for block in result.get('content', []):
                    if block.get('type') == 'text':
                        try:
                            payloads.append(json.loads(block['text']))
                        except (ValueError, KeyError):
                            pass
                related = set()
                for record in records(payloads):
                    for key, value in record.items():
                        if key not in ('path', 'file_path', 'file', 'caller_file', 'callee_file', 'caller_file_path', 'called_file_path', 'target_file_path') or not isinstance(value, str):
                            continue
                        try:
                            path = Path(value)
                            relative = path.resolve().relative_to(root).as_posix() if path.is_absolute() else path.as_posix()
                            path = safe_path(root, relative)
                            if len(sources) >= 12 and relative not in sources:
                                continue
                            content = read_source(path)
                            if content is not None:
                                sources[relative] = content
                                related.add(relative)
                        except (ValueError, OSError, UnicodeError):
                            continue
                traces.append({'anchor': name, 'symbol': target, 'relationship': relation, 'files': sorted(related)})
    except Exception as exc:
        warnings.append(f'KG unavailable ({type(exc).__name__}). Check the MCP connection and repository index. Document-only context remains available.')
    status = 'ready' if any(t['files'] for t in traces) else 'unavailable'
    if not sources and not warnings:
        warnings.append('No usable graph paths found. Index this checkout in KG; document-only context used.')
    return sources, {'status': status, 'traces': traces, 'warnings': warnings}
