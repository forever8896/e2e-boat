import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('casting off marks a boat as departed', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Cast off Marigold').tap();
  await expect(screen.getByLabel('Marigold')).toContainText('Departed');
  await expect(screen.getByTestId('count')).toHaveText('1 boat in harbour');
});
