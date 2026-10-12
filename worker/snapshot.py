"""Committed-source staging worker. The Electron host owns publication.

Only Git objects are read. Repository paths are SQLite keys, never output paths.
Source bytes live in hash-named files; symlinks/submodules are never followed.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
POLICY = 'snapshot-v1'
DOC_EXT = {'.md', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.ini', '.xml', '.csv', '.lock', '.svg', '.html', '.css'}
EXCLUDED_DIRS = {'node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', 'vendor'}


class Failure(Exception):
    pass


def filesystem_path(value):
    path = str(Path(value).resolve())
    if os.name == 'nt' and not path.startswith('\\\\?\\'):
        path = '\\\\?\\UNC\\' + path[2:] if path.startswith('\\\\') else '\\\\?\\' + path
    return Path(path)


def emit(event):
    print(json.dumps({'v': 1, **event}), flush=True)


def git(mirror, *args):
    try:
        result = subprocess.run(['git', '--no-replace-objects', '-C', str(mirror), *args], capture_output=True, timeout=60,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode or len(result.stdout) > 32 * 1024 * 1024:
            raise Failure('GIT')
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        raise Failure('GIT')


class Analyzer:
    def __init__(self):
        from_mcp = Path(__file__).with_name('mcp_client.py')
        import importlib.util
        spec = importlib.util.spec_from_file_location('mcp_client', from_mcp)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        try:
            self.client = module.Client()
            self.version = 'snapshot-v2-mcp/repowise-0.55.0'
            self.ready = True
        except Exception:
            raise Failure('MCP')

    def parse(self, path, source, blob):
        import base64
        try:
            result = self.client.call('parse_source', {'path': path, 'source': base64.b64encode(source).decode('ascii'), 'blob': blob})
            if result['hash'] != hashlib.sha256(source).hexdigest(): raise ValueError('Hash')
            record = result['record']
            if not isinstance(record, list) or len(record) != 5: raise ValueError('Record')
            status, reason, language, symbols, calls = record
            if status not in ('parsed', 'failed', 'unsupported', 'document-only'): raise ValueError('Status')
            if not isinstance(reason, str) or not isinstance(language, str): raise ValueError('Language')
            lines = len(source.splitlines())
            if not isinstance(symbols, list) or not isinstance(calls, list): raise ValueError('Structure')
            for item in symbols:
                if set(item) != {'id', 'name', 'kind', 'start', 'end'} or not all(isinstance(item[k], str) for k in ('id','name','kind')): raise ValueError('Symbol')
                if type(item['start']) is not int or type(item['end']) is not int or not 1 <= item['start'] <= item['end'] <= lines: raise ValueError('Span')
            for item in calls:
                if set(item) != {'target', 'caller', 'line', 'resolution'} or item['resolution'] != 'unresolved': raise ValueError('Call')
                if not isinstance(item['target'],str) or not isinstance(item['caller'],str) or type(item['line']) is not int or not 1 <= item['line'] <= lines: raise ValueError('Call')
            return tuple(record)
        except Exception:
            raise Failure('MCP')


def changes(mirror, base, commit, entries):
    if not base:
        return [('added', path, None) for path, *_ in entries]
    parts = git(mirror, 'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', base, commit, '--').split(b'\0')
    records = []
    index = 0
    while index < len(parts) and parts[index]:
        status = parts[index].decode('ascii'); index += 1
        path = parts[index].decode('utf-8'); index += 1
        if status.startswith('R'):
            target = parts[index].decode('utf-8'); index += 1
            records.append(('renamed', target, path))
        else:
            records.append(({'A': 'added', 'D': 'deleted'}.get(status, 'modified'), path, None))
    return records


def build(request):
    if set(request) != {'v', 'mirror', 'stage', 'previous', 'commit', 'base'} or request['v'] != 1:
        raise Failure('INVALID')
    commit = request['commit']; base = request['base']
    if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40,64}', commit) or (base and not re.fullmatch(r'[a-f0-9]{40,64}', base)):
        raise Failure('INVALID')
    mirror = Path(request['mirror']); stage = Path(request['stage'])
    if git(mirror, 'rev-parse', '--verify', commit + '^{commit}').decode().strip() != commit:
        raise Failure('INVALID')
    entries = []
    for raw in git(mirror, 'ls-tree', '-r', '-l', '-z', '--full-tree', commit).split(b'\0'):
        if not raw:
            continue
        fields, path = raw.split(b'\t', 1)
        mode, kind, blob, size = fields.split()
        name = path.decode('utf-8')
        if len(name) > 4096:
            raise Failure('LIMIT')
        entries.append((name, mode.decode(), kind.decode(), blob.decode(), int(size) if size != b'-' else 0))
    if len(entries) > 100000:
        raise Failure('LIMIT')
    stage.mkdir(parents=True, exist_ok=True)
    blobs = filesystem_path(stage / 'blobs'); blobs.mkdir(exist_ok=True)
    analyzer = Analyzer()
    db = sqlite3.connect(stage / 'index.sqlite3')
    db.row_factory = sqlite3.Row
    previous = None
    try:
        db.executescript('''
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mode TEXT, blob TEXT, size INTEGER,
            hash TEXT, status TEXT, reason TEXT, language TEXT, symbols TEXT, calls TEXT, analyzer TEXT);
          CREATE TABLE IF NOT EXISTS changes (kind TEXT, path TEXT, old_path TEXT);
          CREATE TABLE IF NOT EXISTS invalidated (path TEXT PRIMARY KEY, reason TEXT);
        ''')
        stored = dict(db.execute('SELECT key,value FROM metadata'))
        if stored and (stored.get('commit') != commit or stored.get('base', '') != (base or '')):
            raise Failure('INVALID')
        with db:
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('commit', commit))
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('base', base or ''))
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('complete', '0'))
        if request['previous']:
            old = Path(request['previous'])
            previous = sqlite3.connect((old / 'index.sqlite3').as_uri() + '?mode=ro', uri=True)
            previous.row_factory = sqlite3.Row
            if dict(previous.execute('SELECT key,value FROM metadata')).get('commit') != base:
                raise Failure('INVALID')
        delta = changes(mirror, base, commit, entries)
        reused = 0; total_bytes = 0
        emit({'type': 'progress', 'processed': 0, 'total': len(entries)})
        for index, (path, mode, kind, blob, size) in enumerate(entries):
            existing = db.execute('SELECT * FROM files WHERE path=?', (path,)).fetchone()
            prior = existing or (previous.execute('SELECT * FROM files WHERE path=?', (path,)).fetchone() if previous else None)
            if prior and prior['blob'] == blob and prior['mode'] == mode and prior['analyzer'] == analyzer.version:
                valid = True
                if prior['hash']:
                    if not re.fullmatch(r'[a-f0-9]{64}', prior['hash']): raise Failure('INVALID')
                    content = (blobs if existing else filesystem_path(Path(request['previous']) / 'blobs')) / prior['hash']
                    valid = content.exists() and hashlib.sha256(content.read_bytes()).hexdigest() == prior['hash']
                    if valid and not existing and not (blobs / prior['hash']).exists():
                        shutil.copyfile(content, blobs / prior['hash'])
                if valid:
                    if prior['hash']: total_bytes += size
                    if not existing:
                        with db:
                            db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?)', tuple(prior))
                    reused += 1
                    if total_bytes > MAX_TOTAL:
                        raise Failure('LIMIT')
                    if index % 20 == 0 or index + 1 == len(entries):
                        emit({'type': 'progress', 'processed': index + 1, 'total': len(entries)})
                    continue
            source_hash = None; symbols = []; calls = []; language = Path(path).suffix.lower() or 'unknown'
            reason = None
            if kind != 'blob' or mode == '120000': reason = 'Symlink or submodule; not followed'
            elif any(part in EXCLUDED_DIRS for part in path.split('/')): reason = 'Dependency or generated directory'
            elif size > MAX_FILE: reason = 'File exceeds 2 MiB source limit'
            if reason:
                status = 'excluded'
            else:
                total_bytes += size
                if total_bytes > MAX_TOTAL: raise Failure('LIMIT')
                source = git(mirror, 'cat-file', 'blob', blob)
                algorithm = hashlib.sha1 if len(blob) == 40 else hashlib.sha256
                if len(source) != size or algorithm(b'blob ' + str(size).encode() + b'\0' + source).hexdigest() != blob:
                    raise Failure('INVALID')
                try:
                    source.decode('utf-8')
                    if b'\0' in source: raise UnicodeError()
                except UnicodeError:
                    status = 'excluded'; reason = 'Binary or non-UTF-8 source'
                else:
                    source_hash = hashlib.sha256(source).hexdigest()
                    target = blobs / source_hash
                    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != source_hash:
                        temporary = blobs / (source_hash + '.tmp')
                        temporary.write_bytes(source); temporary.replace(target)
                    status, reason, language, symbols, calls = analyzer.parse(path, source, blob)
            with db:
                db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                           (path, mode, blob, size, source_hash, status, reason, language, json.dumps(symbols), json.dumps(calls), analyzer.version))
            if index % 20 == 0 or index + 1 == len(entries):
                emit({'type': 'progress', 'processed': index + 1, 'total': len(entries)})
        with db:
            db.execute('DELETE FROM changes'); db.execute('DELETE FROM invalidated')
            db.executemany('INSERT INTO changes VALUES (?,?,?)', delta)
            # Until complete cross-language dependencies are established, conservatively
            # invalidate all derived file records, including transitive dependents.
            if delta:
                db.executemany('INSERT OR IGNORE INTO invalidated VALUES (?,?)', [(path, 'Commit changed; conservative dependency invalidation') for path, *_ in entries])
                db.executemany('INSERT OR IGNORE INTO invalidated VALUES (?,?)', [(old or path, 'Removed or renamed source') for kind, path, old in delta if kind in {'deleted', 'renamed'}])
        counts = dict(db.execute('SELECT status,count(*) FROM files GROUP BY status'))
        if sum(counts.values()) != len(entries) or db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise Failure('INVALID')
        summary = {'commit': commit, 'files': len(entries), 'parsed': counts.get('parsed', 0), 'documentOnly': counts.get('document-only', 0),
                   'unsupported': counts.get('unsupported', 0), 'excluded': counts.get('excluded', 0), 'failed': counts.get('failed', 0),
                   **{kind: sum(1 for item in delta if item[0] == kind) for kind in ['added', 'modified', 'deleted', 'renamed']},
                   'reused': reused, 'affected': db.execute('SELECT count(*) FROM invalidated').fetchone()[0], 'analyzer': analyzer.version}
        with db:
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('summary', json.dumps(summary)))
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', ('complete', '1'))
        emit({'type': 'complete', 'snapshot': summary})
    finally:
        if previous: previous.close()
        db.close()
        analyzer.client.close()


if __name__ == '__main__':
    try:
        if sys.version_info[:2] not in ((3, 12), (3, 14)): raise Failure('RUNTIME')
        line = sys.stdin.buffer.readline(65537)
        if len(line) > 65536: raise Failure('INVALID')
        build(json.loads(line))
    except Failure as error:
        emit({'type': 'failure', 'code': str(error)})
        sys.exit(1)
    except (OSError, sqlite3.Error):
        emit({'type': 'failure', 'code': 'STORAGE'})
        sys.exit(1)
    except Exception:
        emit({'type': 'failure', 'code': 'INVALID'})
        sys.exit(1)
