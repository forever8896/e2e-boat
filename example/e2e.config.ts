import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { boat } from '../src/index.ts';

// The app is a static server on this machine, started by e2e. The browser is Chrome in a Boat sandbox,
// and `localhost: [5188]` is what lets it open the app.
export default {
  targets: [
    {
      engine: web({ browser: boat({ localhost: [5188] }) }),
      app: { url: 'http://localhost:5188', command: { executable: 'python3', args: ['-m', 'http.server', '5188', '--bind', '127.0.0.1', '--directory', 'site'] } },
    },
  ],
  workers: Number(process.env.WORKERS ?? 3),
} satisfies E2EConfig;
