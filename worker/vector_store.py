"""LanceDB storage scoped to one immutable application snapshot."""
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import sys

def main(request):
    import lancedb
    import pyarrow as pa
    root = Path(request['directory']).resolve()
    commit, profile = request['commit'], request['profile']
    if not re.fullmatch('[a-f0-9]{40,64}', commit) or not re.fullmatch('[a-f0-9]{64}', profile): raise ValueError('Scope')
    with sqlite3.connect((root / 'index.sqlite3').as_uri() + '?mode=ro', uri=True) as source:
        metadata = dict(source.execute('SELECT key,value FROM metadata'))
        if metadata.get('complete') != '1' or metadata.get('commit') != commit: raise ValueError('Snapshot')
    db = lancedb.connect(str(root.parent.parent / 'vectors' / 'lancedb'))
    # Short physical names avoid Windows path limits. Full identities remain in schema metadata.
    scope = hashlib.sha256((root.name + profile).encode()).hexdigest()
    cache_name = 'v_' + profile[:24]
    name = 's_' + scope[:24]
    def checked(table, identity):
        if (table.schema.metadata or {}).get(b'identity') != identity.encode(): raise ValueError('Table identity')
        return table
    op = request['operation']
    if op == 'lookup':
        keys = request['keys']
        if not isinstance(keys, list) or len(keys) > 8 or any(not re.fullmatch('[a-f0-9]{64}', key) for key in keys): raise ValueError('Keys')
        if not keys or cache_name not in db.table_names(): return {}
        rows = checked(db.open_table(cache_name), profile).search().where('key IN (' + ','.join("'" + key + "'" for key in keys) + ')').limit(8).to_list()
        return {row['key']: row['vector'] for row in rows}
    if op == 'put':
        rows = request['rows']
        if not isinstance(rows, list) or not 1 <= len(rows) <= 8: raise ValueError('Batch')
        dimension = len(rows[0]['vector'])
        if not 1 <= dimension <= 8192: raise ValueError('Dimension')
        for row in rows:
            if any(not re.fullmatch('[a-f0-9]{64}', row[k]) for k in ('key', 'id', 'hash')): raise ValueError('Identity')
            if len(row['vector']) != dimension or any(type(x) not in (int, float) or not math.isfinite(x) for x in row['vector']): raise ValueError('Vector')
            if not any(row['vector']): raise ValueError('Zero vector')
            with sqlite3.connect((root / 'index.sqlite3').as_uri() + '?mode=ro', uri=True) as source:
                record = source.execute('SELECT hash FROM files WHERE path=?', (row['path'],)).fetchone()
            if record != (row['hash'],) or type(row['start']) is not int or type(row['end']) is not int or not 1 <= row['start'] <= row['end'] or row['end'] - row['start'] >= 40: raise ValueError('Evidence scope')
        vector = pa.list_(pa.float32(), dimension)
        cache_schema = pa.schema([('key', pa.string()), ('vector', vector)], metadata={'identity': profile})
        schema = pa.schema([('key', pa.string()), ('id', pa.string()), ('hash', pa.string()), ('path', pa.string()), ('start', pa.int64()), ('end', pa.int64()), ('vector', vector)], metadata={'identity': scope})
        cache = checked(db.create_table(cache_name, schema=cache_schema, exist_ok=True), profile)
        table = checked(db.create_table(name, schema=schema, exist_ok=True), scope)
        if table.schema.field('vector').type.list_size != dimension or cache.schema.field('vector').type.list_size != dimension: raise ValueError('Embedding dimension changed; select a versioned model')
        cache.merge_insert('key').when_matched_update_all().when_not_matched_insert_all().execute([{k: row[k] for k in ('key', 'vector')} for row in rows])
        table.merge_insert('id').when_matched_update_all().when_not_matched_insert_all().execute(rows)
        return {'written': len(rows)}
    if op == 'search':
        if name not in db.table_names(): return []
        vector = request['vector']
        if not isinstance(vector, list) or not 1 <= len(vector) <= 8192 or any(type(x) not in (int, float) or not math.isfinite(x) for x in vector) or not any(vector): raise ValueError('Query vector')
        return [{k: row[k] for k in ('id', 'hash', 'path', 'start', 'end')} | {'kind': 'module'} for row in checked(db.open_table(name), scope).search(vector).distance_type('cosine').limit(6).to_list()]
    raise ValueError('Operation')

if __name__ == '__main__':
    while True:
        data = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
        if not data: break
        try:
            if len(data) > 2 * 1024 * 1024: raise ValueError('Limit')
            print(json.dumps({'ok': True, 'data': main(json.loads(data))}), flush=True)
        except Exception:
            print(json.dumps({'ok': False}), flush=True)
        if '--serve' not in sys.argv: break
