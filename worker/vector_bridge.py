"""Launch the separate tool's LanceDB runtime; the app worker stays stdlib-only."""
import json
import os
from pathlib import Path
import subprocess
import sys

try:
    settings = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodebaseIntelligence'
    location = os.environ.get('CODEBASE_INTELLIGENCE_REPOWISE_HOME')
    if not location:
        location = json.loads((settings / 'repowise-tool.json').read_text(encoding='utf-8-sig'))['directory']
    root = Path(location)
    if not root.is_absolute(): raise ValueError('Scope')
    child = subprocess.Popen([str(root / 'runtime' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')), '-I', '-u', str(root / 'vector_store.py'), '--serve'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        while True:
            data = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
            if not data: break
            if len(data) > 2 * 1024 * 1024: raise ValueError('Limit')
            child.stdin.write(data); child.stdin.flush()
            reply = child.stdout.readline(2 * 1024 * 1024 + 1)
            if not reply or len(reply) > 2 * 1024 * 1024: raise ValueError('Reply')
            sys.stdout.buffer.write(reply); sys.stdout.buffer.flush()
    finally:
        child.stdin.close()
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: child.kill()
except Exception:
    print(json.dumps({'ok': False}), flush=True)
    sys.exit(1)
