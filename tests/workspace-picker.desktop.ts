import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { python, temporary } from './helpers';

test('workspace picker cancels safely, remembers location and opens only the selected folder', async () => {
  const data = await temporary('picker-data-'); const workspace = await temporary('picker-folder-');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: data, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.getByRole('button', { name: 'Clone remote', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Clone and connect', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Choose workspace folder', exact: true }).click();
    const cancelled = await page.evaluate(() => window.desktop.status()); expect(cancelled.ok && cancelled.status.sync.workspaceFolder).toBeUndefined();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
    await page.getByRole('button', { name: 'Choose workspace folder', exact: true }).click();
    await expect(page.locator('.workspace-path')).toHaveText(workspace);
    await expect(page.getByRole('button', { name: 'Clone and connect', exact: true })).toBeEnabled();
    await app.evaluate(({ shell }, folder) => { shell.openPath = async target => { if (target !== folder) throw new Error('Unexpected open target'); return ''; }; }, workspace);
    await page.getByRole('button', { name: 'Open workspace folder', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/workspace-picker.png' });
    await app.close(); app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); page = await app.firstWindow();
    await expect(page.locator('.workspace-path')).toHaveText(workspace);
  } finally { await app.close(); }
});
