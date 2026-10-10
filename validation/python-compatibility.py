"""Read-only parsing probe using the installed pinned RepoWise and upstream fixtures."""
import importlib.metadata
import json
from pathlib import Path
import sys
from datetime import datetime, timezone
from repowise.core.ingestion import ASTParser, FileInfo
from repowise.core.ingestion.languages.registry import REGISTRY

root = Path(__file__).resolve().parents[1]
pin = json.loads((root / 'validation/phase1-pins.json').read_text(encoding='utf-8'))['repowise']['commit']
samples = root / '.research' / ('repowise-' + pin) / 'tests/fixtures/lang_samples'
rows = []
for path in sorted(samples.rglob('*')):
    if not path.is_file() or path.suffix == '.pyc' or '__pycache__' in path.parts:
        continue
    language = REGISTRY.from_extension(path.suffix)
    if language == 'unknown':
        continue
    source = path.read_bytes()
    info = FileInfo(path=path.relative_to(samples).as_posix(), abs_path=str(path), language=language,
                    size_bytes=len(source), git_hash='', last_modified=datetime(2000, 1, 1, tzinfo=timezone.utc),
                    is_test=False, is_config=False, is_api_contract=False, is_entry_point=False)
    parsed = ASTParser().parse_file(info, source)
    rows.append(dict(file=info.path, language=language, symbols=len(parsed.symbols), calls=len(parsed.calls), errors=parsed.parse_errors))
report = dict(python=sys.version.split()[0], repowise=importlib.metadata.version('repowise'), files=len(rows), languages=sorted({row['language'] for row in rows}), rows=rows)
Path(sys.argv[1]).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'rows'}))
