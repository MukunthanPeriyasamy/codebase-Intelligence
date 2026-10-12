"""Bounded retrieval over the published inventory; never executes repository code."""
import hashlib
import json
import re

STOP = set('a an the is are was were where find locate defined definition function method class symbol of in on to and or how does do what why this that it its explain describe please which can you me called calls callers call uses used by workflow return returns'.split())


def terms(text):
    words = re.findall(r'[\w./-]+', text)
    result = []
    for word in words:
        for token in [word, *re.sub(r'([a-z])([A-Z])', r'\1 \2', word).split()]:
            token = token.lower().strip('./-')
            if len(token) > 1 and token not in STOP and token not in result:
                result.append(token)
    return result[:24]


# Intent hints expand ordinary language into repository vocabulary. They only
# rank captured evidence; they never assert that a feature exists.
INTENTS = [
    (r'architect|overview|summari[sz]e|purpose|improv|refactor|recommend|what.*(?:project|repo|application|codebase).*(?:do|about)|how.*(?:project|application|system).*work|structure|tech.?stack',
     ['readme', 'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'main', 'index', 'app', 'server'], True),
    (r'install|setup|set up|start|launch|run.*(?:app|project)|deploy|build',
     ['readme', 'docker', 'compose', 'package.json', 'pyproject.toml', 'makefile', 'scripts', 'main', 'server'], False),
    (r'config|environment|setting|port|timeout',
     ['config', 'settings', 'environ', 'getenv', 'process.env', 'timeout', 'port', 'readme'], False),
    (r'security|secure|vulnerab|auth|permission|login|sign.?in|password|credential',
     ['auth', 'security', 'permission', 'token', 'password', 'session', 'login', 'middleware'], False),
    (r'test|coverage|verify|validation',
     ['test', 'spec', 'assert', 'pytest', 'vitest', 'jest', 'playwright'], False),
    (r'database|persist|stor(?:e|age)|saving|saved',
     ['database', 'sqlite', 'schema', 'migration', 'repository', 'storage', 'write', 'save'], False),
    (r'bug|error|fail|crash|exception|debug|wrong',
     ['error', 'except', 'catch', 'throw', 'raise', 'retry', 'validate', 'test'], False),
    (r'performance|slow|speed|optimi|bottleneck|cache',
     ['cache', 'batch', 'async', 'await', 'timeout', 'pool', 'limit', 'query'], False),
    (r'dependen|librar|framework|package',
     ['package.json', 'requirements', 'pyproject.toml', 'cargo.toml', 'go.mod', 'import', 'require'], False),
]


def plan(question):
    hints = []; overview = False
    for pattern, words, broad in INTENTS:
        if re.search(pattern, question, re.I):
            hints.extend(word for word in words if word not in hints)
            overview = overview or broad
    return hints[:32], overview


def retrieve(db, root, request, read_source):
    question = request['question']
    if not isinstance(question, str) or not 1 <= len(question) <= 8000: raise ValueError('question')
    expanded = request.get('expanded') is True
    tokens = terms(question)
    hints, overview = plan(question)
    route = 'graph' if re.search(r'\b(call|calls|caller|callers|workflow|flow|depend|depends)\b', question, re.I) else 'source'
    quoted = re.findall(r'`([^`]+)`', question)
    target = quoted[0] if len(quoted) == 1 else (tokens[0] if len(tokens) == 1 else None)
    lookup = not hints and bool(re.match(r'^\s*(where\s+(?:is|are)|find|locate|definition\s+of)\b', question, re.I))
    rows = []; symbol_count = 0; limited = False
    for row in db.execute('SELECT path,hash,size,status,symbols,calls FROM files WHERE hash IS NOT NULL ORDER BY path LIMIT 10001'):
        if len(rows) == 10000 or symbol_count > 100000:
            limited = True; break
        item = dict(row); item['symbols'] = json.loads(item['symbols']); item['calls'] = json.loads(item['calls'])
        symbol_count += len(item['symbols'])
        rows.append(item)
    candidates = {}; exact = []; gaps = []; edges = []

    def add(row, line, score):
        line = max(1, line)
        key = (row['path'], line)
        if score > candidates.get(key, (0, None))[0]: candidates[key] = (score, row)
        if len(candidates) > 128:
            weakest = min(candidates, key=lambda key: candidates[key][0]); del candidates[weakest]

    for row in rows:
        path_score = sum(4 for token in tokens if token in row['path'].lower()) + sum(7 for token in hints if token in row['path'].lower())
        if path_score: add(row, 1, path_score)
        for symbol in row['symbols']:
            name = symbol['name']
            if target and (name == target or name.lower() == target.lower() or symbol['id'] == target):
                exact.append((row, symbol)); add(row, symbol['start'], 100)
            score = sum(12 for token in tokens if token in name.lower())
            if score: add(row, symbol['start'], score + path_score)
    if exact: route = 'symbol' if route != 'graph' else route
    if lookup and len(exact) == 1 and not limited:
        row, symbol = exact[0]
        lines = read_source(root, row)
        start = symbol['start']; end = min(symbol['end'], start + 39, max(1, len(lines)))
        return {'units': [unit(row, start, end)], 'exact': True, 'route': 'symbol', 'gaps': ['Symbol location is extracted; runtime behavior has not been verified.'], 'scanned': len(rows), 'edges': []}
    if len(exact) > 1: gaps.append('The symbol name is ambiguous; matching definitions are candidates, not a unique lookup.')
    if route == 'graph':
        frontier = {symbol['id'] for _, symbol in exact}; names = {symbol['name'].split('.')[-1] for _, symbol in exact}
        if not names: names = set(tokens)
        visited = set()
        for _hop in range(2):
            next_names = set()
            for row in rows:
                for call in row['calls']:
                    leaf = re.split(r'[.:]', call['target'])[-1]
                    key = (row['path'], call['line'], call['target'])
                    if key in visited or len(edges) >= 24: continue
                    if call['caller'] in frontier or leaf in names:
                        visited.add(key)
                        edges.append({'path': row['path'], 'line': call['line'], 'target': call['target'][:1000], 'resolution': 'unresolved'})
                        add(row, call['line'], 70); next_names.add(leaf)
            frontier = set(); names = next_names
            for row in rows:
                for symbol in row['symbols']:
                    if symbol['name'].split('.')[-1] in names:
                        frontier.add(symbol['id']); add(row, symbol['start'], 60)
        gaps.append('Graph expansion is limited to two hops and 24 unresolved name-matched call sites; imports, dispatch and runtime relationships may be missing or ambiguous.')
    # Search metadata-ranked files first, then a bounded full-inventory source fallback.
    ranked = sorted(rows, key=lambda row: (-sum(2 if token in hints else 1 for token in [*tokens, *hints] if token in row['path'].lower()), row['path']))
    scanned = 0; byte_count = 0; max_files = 2000 if expanded else 256; max_bytes = (32 if expanded else 8) * 1024 * 1024
    for row in ranked:
        if scanned >= max_files or byte_count + row['size'] > max_bytes:
            limited = True; break
        lines = read_source(root, row); scanned += 1; byte_count += row['size']
        matches = 0
        for index, line in enumerate(lines):
            score = sum(2 for token in tokens if token in line.lower()) + sum(1 for token in hints if token in line.lower())
            if score:
                add(row, index + 1, score); matches += 1
                if matches == 8: break
    if overview:
        gaps.append('Repository overview uses a bounded sample of entry points, manifests and matching source; it is not a complete audit.')
    selected = []; ranges = []; file_counts = {}
    for (path, line), (_, row) in sorted(candidates.items(), key=lambda pair: (-pair[1][0], pair[0])):
        if len(selected) >= (12 if expanded else 6): break
        if file_counts.get(path, 0) >= (1 if hints else 2): continue
        lines = read_source(root, row)
        start = max(1, line - 3); end = min(start + 39, max(1, len(lines)))
        if any(p == path and not (end < a or start > b) for p, a, b in ranges): continue
        file_counts[path] = file_counts.get(path, 0) + 1
        ranges.append((path, start, end)); selected.append(unit(row, start, end))
    if limited: gaps.append('Retrieval reached its file, symbol or source-byte limit; absence of a match does not prove absence from the repository.')
    excluded = db.execute("SELECT count(*) FROM files WHERE hash IS NULL OR status != 'parsed'").fetchone()[0]
    if excluded: gaps.append(f'{excluded} files have excluded or incomplete structural coverage; retained text remains searchable within limits.')
    if not selected: gaps.append('No matching source evidence was found. Describe the feature, observed behavior, or area you want to investigate.')
    return {'units': selected, 'exact': False, 'route': route, 'gaps': gaps, 'scanned': scanned, 'edges': edges}


def unit(row, start, end):
    identity = hashlib.sha256(f"{row['path']}:{row['hash']}:{start}:{end}".encode()).hexdigest()
    return {'id': identity, 'kind': 'module', 'path': row['path'], 'hash': row['hash'], 'start': start, 'end': end}
