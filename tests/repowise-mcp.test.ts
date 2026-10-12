import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { python } from './helpers';

test('separate MCP tool negotiates, parses captured bytes and refuses an unbound search', async () => {
  const script = `import importlib.util,base64,hashlib
spec=importlib.util.spec_from_file_location('client', ${JSON.stringify(resolve('worker/mcp_client.py')).replaceAll('\\', '/')})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
client=module.Client()
try:
 source=b'def hello():\\n    return 1\\n'
 result=client.call('parse_source',{'path':'hello.py','source':base64.b64encode(source).decode(),'blob':'a'*40})
 assert result['hash']==hashlib.sha256(source).hexdigest()
 assert result['record'][0]=='parsed'
 assert result['record'][3][0]['name']=='hello'
 try: client.call('search_codebase',{'query':'hello','expanded':False})
 except ValueError: pass
 else: raise AssertionError('Unbound search allowed')
 print('verified')
finally: client.close()`;
  const result = await promisify(execFile)(python, ['-I', '-c', script], { windowsHide: true, timeout: 90000 });
  assert.equal(result.stdout.trim(), 'verified');
});

test('missing MCP installation fails explicitly without importing a bundled parser', async () => {
  const result = await promisify(execFile)(python, ['-I', '-c', `import importlib.util
spec=importlib.util.spec_from_file_location('client', ${JSON.stringify(resolve('worker/mcp_client.py')).replaceAll('\\', '/')})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
try: module.Client()
except OSError: print('unavailable')
else: raise AssertionError('Unexpected fallback')`], { windowsHide: true, env: { ...process.env, CODEBASE_INTELLIGENCE_REPOWISE_HOME: resolve('.local/missing-tool-fixture') } });
  assert.equal(result.stdout.trim(), 'unavailable');
});
