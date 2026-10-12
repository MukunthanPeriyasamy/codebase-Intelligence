"""Independent RepoWise-backed MCP adapter; never runs project code or an LLM."""
import argparse
import base64
import hashlib
import importlib.util
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyzer import Analyzer
from mcp.server.fastmcp import FastMCP

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot')
parser.add_argument('--commit')
args = parser.parse_args()
engine = Analyzer()
if not engine.ready:
    raise RuntimeError('Pinned RepoWise 0.55.0 is required')
server = FastMCP('codebase-intelligence-repowise', log_level='ERROR')

@server.tool()
def health() -> dict:
    """Report adapter protocol and engine version, without invoking a model."""
    return {'adapter': 1, 'repowise': '0.55.0'}

@server.tool()
def parse_source(path: str, source: str, blob: str) -> dict:
    """Extract structural symbols and unresolved calls from captured bytes."""
    if len(path) > 4096 or len(source) > 2800000 or len(blob) > 64:
        raise ValueError('Input limit')
    raw = base64.b64decode(source, validate=True)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('Source limit')
    return {'hash': hashlib.sha256(raw).hexdigest(), 'record': engine.parse(path, raw, blob)}

@server.tool()
def search_codebase(query: str, expanded: bool = False) -> dict:
    """Retrieve source spans and RepoWise relationships in the bound commit only."""
    if not args.snapshot or not args.commit or not 1 <= len(query) <= 6000:
        raise ValueError('Snapshot scope or query invalid')
    spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('evidence.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main({'directory': args.snapshot, 'commit': args.commit,
                        'operation': 'retrieve', 'question': query, 'expanded': expanded})

server.run(transport='stdio')
