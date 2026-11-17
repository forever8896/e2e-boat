import fs from 'node:fs/promises';
import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('the log downloads as a file the test can read', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen.getByLabel('Cast off Albatross').tap();
  const download = await browser.waitForDownload(() => screen.getByText('Download the log').tap());
  expect(download.suggestedFilename).toBe('harbour-log.csv');
  expect(await fs.readFile(download.absolutePath, 'utf8')).toBe('boat,state\nAlbatross,departed\nMarigold,in harbour\n');
});
