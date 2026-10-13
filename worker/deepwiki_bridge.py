"""Launch the per-computer DeepWiki runtime; never import it into the app worker."""
import json
import os
from pathlib import Path
import subprocess
import sys

try:
    location = os.environ.get('CODEBASE_INTELLIGENCE_DEEPWIKI_HOME')
    if not location:
        manifest = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodebaseIntelligence' / 'deepwiki-tool.json'
        location = json.loads(manifest.read_text(encoding='utf-8-sig'))['directory']
    root = Path(location)
    if not root.is_absolute():
        raise ValueError('Location')
    executable = root / 'runtime' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    child = subprocess.Popen([str(executable), '-I', '-u', str(root / 'pipeline.py')],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        while True:
            data = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
            if not data:
                break
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Limit')
            child.stdin.write(data)
            child.stdin.flush()
            reply = child.stdout.readline(2 * 1024 * 1024 + 1)
            if not reply or len(reply) > 2 * 1024 * 1024:
                raise ValueError('Reply')
            sys.stdout.buffer.write(reply)
            sys.stdout.buffer.flush()
    finally:
        child.stdin.close()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
except Exception:
    print(json.dumps({'ok': False, 'error': 'DeepWiki runtime is unavailable. Run scripts/setup-deepwiki.ps1 on this computer, then restart the app.'}), flush=True)
    sys.exit(1)
