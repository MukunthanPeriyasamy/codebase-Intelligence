"""Bounded read-only graph preview; never used as query or citation evidence."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


def graph(request):
    root = Path(request['directory']).resolve()
    db = sqlite3.connect((root / 'index.sqlite3').as_uri() + '?mode=ro', uri=True, timeout=1)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN')  # One consistent checkpoint while indexing continues.
        metadata = dict(db.execute('SELECT key,value FROM metadata'))
        if metadata.get('commit') != request['commit']: raise ValueError('commit')
        if not request.get('preview') and metadata.get('complete') != '1': raise ValueError('incomplete')
        count = db.execute('SELECT count(*) FROM files').fetchone()[0]
        nodes = []; edges = []; ids = set(); limited = count > 60

        def identity(text): return hashlib.sha256(text.encode()).hexdigest()
        def node(key, label, kind, path, line, detail):
            nonlocal limited
            key = identity(key)
            if key in ids: return key
            if len(nodes) >= 240: limited = True; return None
            nodes.append(dict(id=key, label=label[:300], kind=kind, path=path, line=line, detail=detail[:300])); ids.add(key)
            return key
        def edge(source, target, kind):
            nonlocal limited
            if not source or not target: return
            if len(edges) >= 400: limited = True; return
            key = identity(source + target + kind)
            if not any(e['id'] == key for e in edges): edges.append(dict(id=key, source=source, target=target, kind=kind))

        for row in db.execute('SELECT path,status,reason,symbols,calls FROM files ORDER BY path LIMIT 60'):
            path = row['path']; file_id = node('file:' + path, path, 'file', path, 0, row['status'] + ': ' + (row['reason'] or ''))
            if len(row['symbols']) + len(row['calls']) > 1024 * 1024: limited = True; continue
            symbols = json.loads(row['symbols']); calls = json.loads(row['calls']); lookup = {}
            if len(symbols) > 20 or len(calls) > 20: limited = True
            for symbol in symbols[:20]:
                sid = node('symbol:' + path + ':' + symbol['id'], symbol['name'], 'symbol', path, symbol['start'], symbol['kind'])
                lookup[symbol['id']] = sid; edge(file_id, sid, 'contains')
            for call in calls[:20]:
                target = node('target:' + path + ':' + call['target'], call['target'], 'unresolved', path, call['line'], 'Unresolved call target; not a proven dependency')
                edge(lookup.get(call['caller']) or file_id, target, 'calls')
        return dict(commit=request['commit'], preview=bool(request.get('preview')), files=count, limited=limited, nodes=nodes, edges=edges)
    finally: db.close()


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.readline(65537)
        if len(raw) > 65536: raise ValueError('limit')
        print(json.dumps({'ok': True, 'data': graph(json.loads(raw))}), flush=True)
    except Exception:
        print(json.dumps({'ok': False}), flush=True); sys.exit(1)
