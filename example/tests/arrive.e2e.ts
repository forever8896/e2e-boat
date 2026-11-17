import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('a boat that arrives is added to the log', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Boat name').fill('Kittiwake');
  await screen.getByText('Add boat').tap();
  await expect(screen.getByLabel('Boats')).toContainText('Kittiwake');
  await expect(screen.getByTestId('count')).toHaveText('3 boats in harbour');
});
