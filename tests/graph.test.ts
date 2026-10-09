import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GraphReader } from '../src/main/graph';
import { actionSchema } from '../src/shared/contracts';
import { python, temporary } from './helpers';

test('graph reads consistent staged checkpoints, rejects unpublished evidence and bounds large graphs', async () => {
  const directory = await temporary('graph-'); const exec = promisify(execFile);
  const run = async (script: string) => exec(python, ['-I', '-c', script, join(directory, 'index.sqlite3')], { windowsHide: true });
  await run(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.executescript('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE files(path TEXT,status TEXT,reason TEXT,symbols TEXT,calls TEXT);')
c.executemany('INSERT INTO metadata VALUES (?,?)',[('commit','${'a'.repeat(40)}'),('complete','0')])
c.execute('INSERT INTO files VALUES (?,?,?,?,?)',('main.py','parsed','Structural extraction',json.dumps([dict(id='main.py::entry',name='entry',kind='function',start=1)]),json.dumps([dict(caller='main.py::entry',target='helper',line=2)]))); c.commit()`);
  const ref = { repoId: randomUUID(), repoName: 'fixture', directory, commit: 'a'.repeat(40), analyzer: 'fixture' };
  const reader = new GraphReader(python, resolve('worker/graph.py'));
  const first = await reader.readGraph(ref, true); assert.equal(first.preview, true); assert.equal(first.nodes.length, 3);
  assert.ok(first.nodes.some(node => node.kind === 'unresolved' && node.label === 'helper'));
  assert.deepEqual(first.edges.map(edge => edge.kind), ['contains', 'calls']);
  await assert.rejects(reader.readGraph(ref, false)); await assert.rejects(reader.readGraph({ ...ref, commit: 'b'.repeat(40) }, true));
  await run(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.executemany('INSERT INTO files VALUES (?,?,?,?,?)',[(f'z{i}.py','parsed','',json.dumps([dict(id=f's{j}',name=f'symbol{j}',kind='function',start=1) for j in range(30)]),'[]') for i in range(100)]); c.execute("UPDATE metadata SET value='1' WHERE key='complete'"); c.commit()`);
  const final = await reader.readGraph(ref, false); assert.equal(final.files, 101); assert.equal(final.limited, true); assert.ok(final.nodes.length <= 240); assert.ok(final.edges.length <= 400);
  const ids = new Set(final.nodes.map(node => node.id)); assert.ok(final.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
  assert.equal(actionSchema.safeParse({ type: 'repository.graph', directory: 'C:/private' }).success, false);
});
