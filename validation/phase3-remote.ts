// Optional network smoke test; normal test suites use owned local Git fixtures.
import { RepositoryService } from '../src/main/repositories';
import { python, temporary } from '../tests/helpers';
import { resolve } from 'node:path';

const directory = process.argv[2] ? resolve(process.argv[2]) : await temporary('remote-smoke-');
console.log(`Smoke test storage: ${directory}`);
const service = new RepositoryService({ directory, python, script: resolve('worker/snapshot.py') }, () => {});
try {
  await service.initialize();
  if (!service.status.repository) await service.connect('remote', 'https://github.com/sindresorhus/p-limit.git', '');
  await service.settle();
  if (service.status.phase !== 'ready') throw new Error(service.status.error ?? 'Remote smoke failed');
  console.log(JSON.stringify(service.status.repository, null, 2));
} finally { await service.close(); }
