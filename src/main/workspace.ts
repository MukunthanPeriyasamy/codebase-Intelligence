import { mkdir, realpath, lstat, writeFile, rename, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocPage } from '../shared/documentation';
import { git, RepoError } from './git';

export async function workspaceDirectory(path: string): Promise<string> {
  const actual = await realpath(path);
  if (!(await lstat(actual)).isDirectory()) throw new RepoError('Choose an existing workspace folder.');
  return actual;
}
export async function ownedDirectory(root: string, ...parts: string[]): Promise<string> {
  const base = resolve(root);
  if (await realpath(base) !== base) throw new RepoError('The workspace location changed. Choose the folder again.');
  let current = base;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..') throw new RepoError('Invalid workspace subfolder.');
    current = join(current, part);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) throw new RepoError('Workspace subfolders must be real directories, not links.');
  }
  return current;
}
export async function createProject(folder: string, name: string): Promise<string> {
  const root = await workspaceDirectory(folder);
  const slug = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50) || 'repository';
  const project = join(root, `repo-${slug}-${randomUUID().slice(0, 8)}`);
  await mkdir(project);
  for (const part of ['repository', 'docs', 'notes', '.codebase-intelligence']) await ownedDirectory(project, part);
  await writeFile(join(project, 'README.md'), '# Repository workspace\n\n- `repository/`: browsable cloned source, one directory per captured commit.\n- `docs/README.md`: latest generated Markdown documentation.\n- `notes/`: your personal notes; never overwritten by generation.\n- `.codebase-intelligence/`: private Git mirror.\n\nSource snapshots and document generations are retained; open the paths shown in the app for the current version. Analysis uses separate immutable application snapshots, not edits made to these copies.\n', { flag: 'wx' });
  return project;
}
export async function exportSource(project: string, mirror: string, commit: string, signal?: AbortSignal): Promise<string> {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new RepoError('Invalid source commit.');
  const root = await ownedDirectory(project, 'repository');
  const metadata = await ownedDirectory(project, '.codebase-intelligence');
  const marker = join(metadata, `source-${commit}.json`);
  try {
    const saved: unknown = JSON.parse(await readFile(marker, 'utf8'));
    if (typeof saved === 'string' && new RegExp(`^${commit}-[a-f0-9-]{36}$`).test(saved)) {
      const target = join(root, saved); const info = await lstat(target);
      if (info.isDirectory() && !info.isSymbolicLink() && await realpath(target) === target) return target;
    } else throw new RepoError('Invalid source export marker.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new RepoError('The saved source export is unavailable. Check the workspace folder.'); }
  const name = `${commit}-${randomUUID()}`;
  const target = join(root, name);
  await git(['clone', '--no-checkout', '--no-local', '--', mirror, target], signal);
  await git(['-C', target, '-c', 'core.symlinks=false', 'checkout', '--detach', commit, '--'], signal);
  const markerTemp = join(metadata, `${randomUUID()}.tmp`);
  await writeFile(markerTemp, JSON.stringify(name), { flag: 'wx' });
  try { if ((await lstat(marker)).isSymbolicLink()) throw new RepoError('Source export marker must not be a link.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await rename(markerTemp, marker);
  return target;
}
function md(text: string) { return text.replace(/[\\`*_[\]<>#]/g, '\\$&'); }
export function markdownPage(page: DocPage): string {
  const output = [`# ${md(page.content.title)}`, '', `Commit: ${page.commit}`, `Model: ${md(page.model)}`, '', 'Generated interpretation; source citations verify references, not runtime behavior.', ''];
  for (const section of page.content.sections) {
    output.push(`## ${md(section.title)}`, '');
    for (const claim of section.claims) {
      output.push(`**${claim.basis}** — ${md(claim.text)}`, '');
      for (const citation of claim.citations) {
        const source = page.evidence.find(item => item.id === citation.evidenceId);
        output.push(`- Source: ${md(source?.path ?? 'Unavailable')} · lines ${citation.start}–${citation.end} · commit ${page.commit}`, `  > ${md(citation.quote).replace(/\r?\n/g, '\n  > ')}`);
      }
      output.push('');
    }
  }
  if (page.content.gaps.length) output.push('## Gaps', '', ...page.content.gaps.map(gap => `- ${md(gap)}`), '');
  return output.join('\n');
}
export async function exportMarkdown(project: string, commit: string, pages: DocPage[], remaining: number, omitted: number): Promise<void> {
  const docs = await ownedDirectory(project, 'docs');
  await ownedDirectory(project, 'docs', 'versions');
  const name = `${commit.slice(0, 12)}-${randomUUID()}`;
  const stage = await ownedDirectory(project, 'docs', 'versions', name);
  const links: string[] = [];
  for (const page of pages) {
    const category = page.kind === 'workflow' ? 'workflows' : 'modules';
    const directory = await ownedDirectory(project, 'docs', 'versions', name, category);
    await writeFile(join(directory, `${page.id}.md`), markdownPage(page), { flag: 'wx' });
    links.push(`- [${md(page.content.title)}](${category}/${page.id}.md)`);
    for (const [index, section] of page.content.sections.entries()) if (section.kind === 'function') {
      const functions = await ownedDirectory(project, 'docs', 'versions', name, 'functions');
      const filename = `${page.id}-${index}.md`;
      await writeFile(join(functions, filename), markdownPage({ ...page, content: { ...page.content, title: section.title, sections: [section] } }), { flag: 'wx' });
      links.push(`- [${md(section.title)}](functions/${filename})`);
    }
  }
  const index = `# Generated documentation\n\nCommit: ${commit}\n\n${pages.length} pages · ${remaining} remaining · ${omitted} excluded/omitted\n\n${links.join('\n')}\n\nPersonal notes belong in the workspace notes folder.\n`;
  await writeFile(join(stage, 'README.md'), index, { flag: 'wx' });
  // Publish one small entry point last. Earlier generation directories stay intact.
  const temporary = join(docs, `${randomUUID()}.tmp`);
  await writeFile(temporary, `# Documentation\n\n[Open latest generated documentation](versions/${name}/README.md)\n\nCommit: ${commit}\n\n${pages.length} pages · ${remaining} remaining · ${omitted} excluded/omitted\n`, { flag: 'wx' });
  const indexPath = join(docs, 'README.md');
  try { if ((await lstat(indexPath)).isSymbolicLink()) throw new RepoError('Documentation index must not be a link.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await rename(temporary, indexPath);
}
