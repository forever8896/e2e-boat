# e2e-boat

**Run [e2e](https://e2e.com) web tests in Chrome on a [Boat](https://boat.dev) sandbox, including against an app on
your own localhost.**

e2e's web engine can take its browser from a provider, and 0.23.1 shipped two more, for Cloudflare and E2B. This is
one for Boat: every worker gets its
own sandbox with the Chrome that Boat ships, and the sandbox is deleted when the run ends.

```ts title="e2e.config.ts"
import { web } from '@e2e-dev/web';
import { boat } from 'e2e-boat';

export default {
  targets: [
    {
      engine: web({ browser: boat({ localhost: [3000] }) }),
      app: { url: 'http://localhost:3000' },
    },
  ],
  workers: 3,
};
```

## Localhost

A browser in someone else's cloud normally can't open `http://localhost:3000`, so hosted browsers need an app that is
reachable from the internet. Here, `localhost: [3000]` forwards that port from your machine into each sandbox for as
long as its browser is leased. The test's `app.url` stays `http://localhost:3000`, and nothing is put on a public
URL.

## Set up

You need Node 22.22 or newer, e2e 0.23.1 or newer with `@e2e-dev/web` 0.16.0 or newer, and the
[Boat CLI](https://boat.dev), signed in (`boat login`).

The package is not on npm yet. Install it from this repository:

```sh
npm install --save-dev github:forever8896/e2e-boat
```

## Options

| Option | Default | |
|---|---|---|
| `localhost` | none | Ports on this machine the browser can open as `localhost`. |
| `type` | `'small'` | Machine size: `small` (2 vCPU, 4 GB), `default` (4 vCPU, 8 GB) or `large` (8 vCPU, 16 GB). |
| `scope` | `'worker'` | `worker`: one sandbox per worker for the whole run. `attempt`: a new sandbox for every test attempt. |
| `ttlSeconds` | `3600` | How long a sandbox may live before Boat removes it, if the run died before it could. |

## What it does

- **One sandbox per worker.** `boat new` with none of your account's stored secrets and without snapshots, named
  after the run, the target and the worker.
- **Chrome on loopback.** The sandbox's own Chrome starts headless with DevTools on `127.0.0.1`. e2e reaches it
  through `boat forward`, so the endpoint e2e gets is a loopback address on your machine and carries no secret.
- **Localhost the other way.** Each `localhost` port goes into the sandbox through `boat forward --reverse`.
- **Downloads.** A file the browser downloads is copied back from the sandbox, so `browser.waitForDownload` works.
- **Clean-up.** Sandboxes are deleted when their browser is released. At the end of the run, any sandbox of that run
  a crashed worker left behind is found by name and deleted, and Boat removes the rest after `ttlSeconds`.

## What it measured

The example in [`example/`](example): a small app served on `localhost:5188`, three test files, three workers.

| | |
|---|---|
| Three sandboxes with Chrome ready | 3.9 s |
| From the command to three passing tests | 13.6 s |
| Sandboxes left afterwards | 0 |

That is one run. Another run of the same example had the sandboxes ready in 2.8 s. I have not run it enough times to
give an average.

## Limits

- **It needs the Boat CLI**, on the machine that runs the tests, and uses whatever account that CLI is signed in to.
  It does not use Boat's HTTP API yet.
- **Each worker is one sandbox start.** Boat plans limit starts per minute (12 on the $20 plan), so `workers` above
  that will fail to lease, and `scope: 'attempt'` spends a start per test attempt.
- **Chrome only**, the stable Chrome a Boat sandbox ships with, headless.
- **Not tested in CI**, and no video recording of its own: e2e records its usual screencast.
- **Unit tests are still to come.** What exists is the live example below.

## Try the example

```sh
git clone https://github.com/forever8896/e2e-boat && cd e2e-boat
npm install
npm run example
```

It starts three sandboxes, runs three tests against a server it starts on `localhost:5188`, and deletes the
sandboxes.

## Status

Built on e2e 0.23.1 with `@e2e-dev/web` 0.16.0 and Boat CLI 1.0.100. Not affiliated with e2e or Boat.

Apache-2.0, the same license as e2e.
