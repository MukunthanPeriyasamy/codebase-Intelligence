const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative) {
  const file = path.resolve(relative);
  const mod = new Module(file, module);
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const nativeRequire = mod.require.bind(mod);
  mod.require = name => name === "@/utils/backend" ? load("src/utils/backend.ts") : nativeRequire(name);
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, file);
  return mod.exports;
}
(async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalBase = process.env.SERVER_BASE_URL;
  try {
    delete process.env.SERVER_BASE_URL;
    const auth = load('src/app/api/auth/status/route.ts');
    const tasks = load('src/app/api/wiki/tasks/route.ts');
    const request = {nextUrl:new URL('http://localhost/api/wiki/tasks?status=active')};
    global.fetch = async url => {
      assert.equal(url, 'http://127.0.0.1:8001/api/v1/auth/status');
      return Response.json({auth_required:true});
    };
    assert.deepEqual(await (await auth.GET()).json(), {auth_required:true});
    global.fetch = async url => {
      assert.equal(url, 'http://127.0.0.1:8001/api/v1/wiki/tasks?status=active');
      return Response.json([{id:'existing'}]);
    };
    assert.deepEqual(await (await tasks.GET(request)).json(), [{id:'existing'}]);
    global.fetch = async () => Response.json({error:'Unauthorized'}, {status:401});
    assert.equal((await auth.GET()).status,401);
    global.fetch = async () => {throw new Error('ECONNREFUSED');};
    console.warn = () => {};
    const authFailure = await auth.GET();
    assert.equal(authFailure.status,503);
    const body = await authFailure.json();
    assert.match(body.error,/npm start/);
    assert.equal(body.auth_required,undefined);
    const tasksFailure = await tasks.GET(request);
    assert.equal(tasksFailure.status,502);
    assert.match((await tasksFailure.json()).error,/Python backend/);
    console.log('Backend proxy success, auth rejection and connection-failure checks passed');
  } finally {
    global.fetch=originalFetch; console.warn=originalWarn;
    if(originalBase===undefined) delete process.env.SERVER_BASE_URL;
    else process.env.SERVER_BASE_URL=originalBase;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
