import contextlib
import hashlib
import importlib.metadata
import sys
from pathlib import Path
from datetime import datetime, timezone
POLICY = "snapshot-v2-mcp"
DOC_EXT = {'.md', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.ini', '.xml', '.csv', '.lock', '.svg', '.html', '.css'}

class Analyzer:
    def __init__(self):
        self.version = POLICY + '/source-only'
        self.ready = False
        try:
            if importlib.metadata.version('repowise') != '0.55.0':
                return
            with contextlib.redirect_stdout(sys.stderr):
                from repowise.core.ingestion import ASTParser, FileInfo
                from repowise.core.ingestion.languages.registry import REGISTRY
                from repowise.core.ingestion.parser import _get_language, grammar_tag_for, SPECIAL_HANDLER_LANGUAGES
            self.parser = ASTParser()
            self.info = FileInfo
            self.registry = REGISTRY
            self.grammar = _get_language
            self.tag = grammar_tag_for
            self.special = SPECIAL_HANDLER_LANGUAGES
            self.version = POLICY + '/repowise-0.55.0'
            self.ready = True
        except Exception:
            pass

    def parse(self, path, source, blob):
        ext = Path(path).suffix.lower()
        if not self.ready:
            return ('document-only' if ext in DOC_EXT else 'unsupported', 'Structural adapter unavailable', ext or 'unknown', [], [])
        language = self.registry.from_extension(ext)
        if language not in self.registry.code_languages() and language not in self.special:
            return ('document-only' if ext in DOC_EXT else 'unsupported', 'Source retained; no structural parser', language or 'unknown', [], [])
        try:
            with contextlib.redirect_stdout(sys.stderr):
                if language not in self.special and self.grammar(self.tag(language, path)) is None:
                    return ('unsupported', 'Grammar unavailable; source retained', language, [], [])
                info = self.info(path=path, abs_path=path, language=language, size_bytes=len(source), git_hash=blob,
                                 last_modified=datetime(2000, 1, 1, tzinfo=timezone.utc), is_test=False,
                                 is_config=False, is_api_contract=False, is_entry_point=False)
                parsed = self.parser.parse_file(info, source)
            lines = len(source.splitlines())
            if parsed.content_hash != hashlib.sha256(source).hexdigest():
                raise ValueError('Hash mismatch')
            symbols = [{'id': s.id, 'name': s.name, 'kind': s.kind, 'start': s.start_line, 'end': s.end_line}
                       for s in parsed.symbols if 1 <= s.start_line <= s.end_line <= lines]
            if len(symbols) != len(parsed.symbols):
                raise ValueError('Span mismatch')
            calls = [{'target': c.target_name, 'caller': c.caller_symbol_id, 'line': c.line, 'resolution': 'unresolved'}
                     for c in parsed.calls if 1 <= c.line <= lines]
            if parsed.parse_errors:
                return ('failed', 'Parser reported errors; source retained', language, symbols, calls)
            if not symbols:
                return ('unsupported', 'No structural symbols extracted; source retained', language, symbols, calls)
            return ('parsed', 'Structural extraction; dynamic behavior remains unproven', language, symbols, calls)
        except Exception:
            return ('failed', 'Structural extraction failed; source retained', language or 'unknown', [], [])

