import { build as bundle } from 'esbuild';
import { build as frontend } from 'vite';
import { cp, mkdir } from 'node:fs/promises';

await frontend({ root: 'src/renderer', base: './', build: { outDir: '../../dist/renderer', emptyOutDir: true } });
await bundle({ entryPoints: { main: 'src/main/index.ts', preload: 'src/preload/index.ts' }, outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
await mkdir('dist/worker', { recursive: true });
await cp('worker/service.py', 'dist/worker/service.py');
await cp('worker/snapshot.py', 'dist/worker/snapshot.py');
await cp('worker/evidence.py', 'dist/worker/evidence.py');
await cp('worker/retrieval.py', 'dist/worker/retrieval.py');

await cp('worker/graph.py', 'dist/worker/graph.py');

await cp('worker/mcp_client.py', 'dist/worker/mcp_client.py');

await cp('worker/vector_bridge.py', 'dist/worker/vector_bridge.py');
