"""Small synchronous stdio MCP client. Only a fixed, locally installed adapter runs."""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

class Client:
    def __init__(self, snapshot=None, commit=None):
        settings = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodebaseIntelligence'
        location = os.environ.get('CODEBASE_INTELLIGENCE_REPOWISE_HOME')
        if not location and (settings / 'repowise-tool.json').exists():
            manifest = (settings / 'repowise-tool.json').read_text(encoding='utf-8-sig')
            if len(manifest) > 16384: raise ValueError('Setup manifest limit')
            location = json.loads(manifest)['directory']
        root = Path(location or settings / 'repowise-tool')
        if not root.is_absolute(): raise ValueError('Tool directory must be absolute')
        python = root / 'runtime' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        command = [str(python), '-I', '-u', str(root / 'server.py')]
        if snapshot: command += ['--snapshot', snapshot, '--commit', commit]
        self.child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.messages = queue.Queue(maxsize=16)
        self.sequence = 0
        threading.Thread(target=self._read, daemon=True).start()
        try:
            result = self.request('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                  'clientInfo': {'name': 'codebase-intelligence', 'version': '1'}})
            if result.get('protocolVersion') not in ('2024-11-05', '2025-03-26', '2025-06-18'): raise ValueError('Protocol')
            self.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            if self.call('health', {}) != {'adapter': 1, 'repowise': '0.55.0'}: raise ValueError('Adapter version')
        except Exception:
            self.close()
            raise

    def _read(self):
        try:
            while True:
                line = self.child.stdout.readline(8 * 1024 * 1024 + 1)
                if not line or len(line) > 8 * 1024 * 1024: break
                self.messages.put(json.loads(line), timeout=1)
        except Exception:
            pass
        try: self.messages.put(None, timeout=1)
        except queue.Full: pass

    def send(self, message):
        self.child.stdin.write((json.dumps(message) + '\n').encode('utf-8'))
        self.child.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        self.send({'jsonrpc': '2.0', 'id': self.sequence, 'method': method, 'params': params})
        for _ in range(16):
            response = self.messages.get(timeout=60)
            if response is None: raise ValueError('MCP disconnected')
            if response.get('id') == self.sequence:
                if 'error' in response: raise ValueError('MCP rejected request')
                return response['result']
        raise ValueError('MCP response limit')

    def call(self, name, arguments):
        result = self.request('tools/call', {'name': name, 'arguments': arguments})
        if result.get('isError'): raise ValueError('MCP tool failed')
        if 'structuredContent' in result: return result['structuredContent']
        return json.loads(result['content'][0]['text'])

    def close(self):
        try:
            self.child.stdin.close()
            self.child.wait(timeout=3)
        except Exception:
            self.child.kill()
            self.child.wait(timeout=3)

if __name__ == '__main__':
    import sys
    client = None
    try:
        request = json.loads(sys.stdin.buffer.readline(65537))
        client = Client(request.get('directory'), request.get('commit'))
        data = client.call('search_codebase', {'query': request['question'], 'expanded': request['expanded']}) if request.get('operation') == 'retrieve' else {'adapter': 1, 'repowise': '0.55.0'}
        print(json.dumps({'ok': True, 'data': data}), flush=True)
    except Exception:
        print(json.dumps({'ok': False}), flush=True)
        sys.exit(1)
    finally:
        if client: client.close()
