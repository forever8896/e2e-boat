/** Chrome on Boat sandboxes as a `BrowserProvider` for e2e's web engine. */
import type { BrowserProvider, BrowserProviderScope } from '@e2e-dev/web';
import { type BoatCli } from './cli.ts';
export interface BoatOptions {
    /**
     * Ports on this machine the browser can open as `localhost`. With `localhost: [3000]`, a test whose
     * `app.url` is `http://localhost:3000` runs against the dev server on your machine, though the browser
     * is in a sandbox: each port is forwarded into the sandbox for as long as its browser is leased.
     */
    readonly localhost?: readonly number[] | undefined;
    /** Machine size: `small` (2 vCPU, 4 GB, the default), `default` (4 vCPU, 8 GB) or `large` (8 vCPU, 16 GB). */
    readonly type?: 'small' | 'default' | 'large' | undefined;
    /**
     * `worker` (default): one sandbox per worker slot, for the whole run. `attempt`: a new sandbox for every
     * test attempt, which costs one sandbox start per attempt.
     */
    readonly scope?: BrowserProviderScope | undefined;
    /**
     * Seconds a sandbox may live before Boat removes it. One hour by default: the backstop for a run that
     * died before it could delete its sandboxes.
     */
    readonly ttlSeconds?: number | undefined;
}
/**
 * Boat browsers for `web({ browser: boat() })`: the Chrome a Boat sandbox ships with, one sandbox per worker
 * slot, or per attempt with `scope: 'attempt'`.
 *
 * The provider drives the `boat` CLI, signed in as you are. Chrome listens on the sandbox's loopback, and
 * the lease's `cdpEndpoint` is a `boat forward` tunnel on this machine's loopback, so it carries no secret
 * and nothing of the sandbox is on a public URL. Each `localhost` port is forwarded the other way.
 *
 * Sandboxes are created with none of your account's stored secrets and without snapshots, named after the
 * run, target and slot, deleted at release, swept at the end of the run, and removed by Boat after
 * `ttlSeconds` if the run died first.
 */
export declare function boat(options?: BoatOptions): BrowserProvider;
/** `boat()` over a given CLI, so tests can stand in for the real one. */
export declare function boatWith(cli: BoatCli, options?: BoatOptions): BrowserProvider;
