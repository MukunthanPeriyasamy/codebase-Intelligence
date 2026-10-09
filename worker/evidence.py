"""Read-only access to an application-owned immutable snapshot for documentation."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys


def disk_path(path):
    value = str(Path(path).resolve())
    if os.name == 'nt' and not value.startswith('\\\\?\\'):
        value = '\\\\?\\UNC\\' + value[2:] if value.startswith('\\\\') else '\\\\?\\' + value
    return Path(value)


def source(root, record):
    if not re.fullmatch('[a-f0-9]{64}', record['hash'] or ''): raise ValueError('hash')
    content = disk_path(root / 'blobs' / record['hash']).read_bytes()
    if len(content) > 2 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != record['hash']: raise ValueError('integrity')
    return content.decode('utf-8').splitlines()


def main(request):
    root = Path(request['directory']).resolve()
    db = sqlite3.connect((root / 'index.sqlite3').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        metadata = dict(db.execute('SELECT key,value FROM metadata'))
        if metadata.get('complete') != '1' or metadata.get('commit') != request['commit']: raise ValueError('snapshot')
        if request['operation'] == 'retrieve':
            # -I excludes the script directory from imports; load only this bundled sibling.
            import importlib.util
            spec = importlib.util.spec_from_file_location('retrieval', Path(__file__).with_name('retrieval.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.retrieve(db, root, request, source)
        if request['operation'] == 'plan':
            units = []; omitted = 0
            for record in db.execute('SELECT path,hash FROM files WHERE hash IS NOT NULL ORDER BY path'):
                if len(units) >= 1999:
                    omitted += 1; continue
                lines = source(root, record)
                for start in range(1, max(len(lines), 1) + 1, 120):
                    if len(units) >= 1999:
                        omitted += 1; continue
                    end = max(start, min(start + 119, len(lines)))
                    identity = hashlib.sha256(f"{record['path']}:{record['hash']}:{start}:{end}".encode()).hexdigest()
                    units.append({'id': identity, 'kind': 'module', 'path': record['path'], 'hash': record['hash'], 'start': start, 'end': end})
            if units:
                identity = hashlib.sha256(('workflow:' + request['commit']).encode()).hexdigest()
                units.append({'id': identity, 'kind': 'workflow', 'path': 'Repository workflow', 'hash': '0' * 64, 'start': 1, 'end': 1})
            excluded = db.execute('SELECT count(*) FROM files WHERE hash IS NULL').fetchone()[0]
            return {'units': units, 'omitted': omitted, 'excluded': excluded}
        if request['operation'] == 'source':
            record = db.execute('SELECT * FROM files WHERE path=?', (request['path'],)).fetchone()
            if not record or record['hash'] != request['hash']: raise ValueError('scope')
            lines = source(root, record)
            start, end = request['start'], request['end']
            if type(start) is not int or type(end) is not int or not 1 <= start <= end <= max(len(lines), 1) or end - start >= 120: raise ValueError('span')
            # Long lines are never returned in unbounded process messages.
            selected = lines[start - 1:end] or ['']
            blocked = [start + index for index, text in enumerate(selected) if len(text.encode('utf-8')) > 12000]
            if any(re.search(r'-----BEGIN .*PRIVATE KEY-----', line) for line in lines):
                blocked = list(range(start, end + 1))
            text = '\n'.join('[OMITTED LONG LINE]' if start + index in blocked else value for index, value in enumerate(selected))
            symbols = json.loads(record['symbols'])
            return {'text': text, 'blocked': blocked, 'symbols': [item for item in symbols if item['start'] <= end and item['end'] >= start][:100]}
        raise ValueError('operation')
    finally:
        db.close()


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.readline(65537)
        if len(data) > 65536: raise ValueError('limit')
        print(json.dumps({'ok': True, 'data': main(json.loads(data))}), flush=True)
    except Exception:
        print(json.dumps({'ok': False}), flush=True)
        sys.exit(1)
