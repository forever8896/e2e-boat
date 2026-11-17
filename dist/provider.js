/** Chrome on Boat sandboxes as a `BrowserProvider` for e2e's web engine. */
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { boatCli } from "./cli.js";
const OPTION_KEYS = ['localhost', 'type', 'scope', 'ttlSeconds'];
const TYPES = ['small', 'default', 'large'];
/** Chrome's DevTools port, on the sandbox's loopback only. */
const CDP_PORT = 9222;
/** Where the browser saves downloads on the sandbox's disk, for the engine to read back. */
const DOWNLOADS_DIR = '/tmp/e2e-downloads';
const CHROME_LOG = '/tmp/e2e-chrome.log';
/** Bounds Chrome's start and its first answer through the tunnel, together. */
const START_TIMEOUT_MS = 60_000;
/** Boat's limit on a sandbox name. */
const NAME_LIMIT = 120;
/**
 * Starts the Chrome a Boat sandbox ships with, headless, with DevTools on loopback. BackForwardCache is off
 * because a history restore from it emits no load event over CDP, which hangs a `goBack` that waits for one.
 */
const START_CHROME = [
    `mkdir -p ${DOWNLOADS_DIR}`,
    `exec google-chrome --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-features=BackForwardCache --remote-debugging-port=${CDP_PORT} --user-data-dir=/tmp/e2e-chrome about:blank > ${CHROME_LOG} 2>&1`,
].join(' && ');
const messageOf = (cause) => (cause instanceof Error ? cause.message : String(cause));
/** The name every sandbox of one run and target starts with: how `sweep` finds what a dead worker left. */
function namePrefix(runId, targetName) {
    return `e2e-${runId}-${targetName.replace(/[^\w.-]+/g, '_')}-`;
}
function sandboxName(request) {
    const attempt = request.attemptId === undefined ? '' : `-a${request.attemptId.replace(/[^\w.-]+/g, '_')}`;
    return `${namePrefix(request.runId, request.targetName)}s${request.slot}${attempt}`.slice(0, NAME_LIMIT);
}
/** A port on this machine nothing listens on, for the tunnel's local end. */
function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no free port'))));
        });
    });
}
/** Polls Chrome through the tunnel until it answers, and resolves to its browser WebSocket endpoint on the tunnel. */
async function browserEndpoint(port, signal) {
    let last = 'no answer';
    while (!signal.aborted) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) });
            const body = response.ok ? await response.json() : undefined;
            const endpoint = typeof body === 'object' && body !== null && 'webSocketDebuggerUrl' in body ? body.webSocketDebuggerUrl : undefined;
            const pathname = typeof endpoint === 'string' && URL.canParse(endpoint) ? new URL(endpoint).pathname : '';
            // Chrome reports the endpoint on its own port; only the path is kept, on the tunnel's port.
            if (pathname.startsWith('/devtools/browser/'))
                return `ws://127.0.0.1:${port}${pathname}`;
            last = response.ok ? 'no WebSocket endpoint in /json/version' : `HTTP ${response.status}`;
        }
        catch (cause) {
            last = messageOf(cause);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Chrome did not answer through the tunnel within ${START_TIMEOUT_MS / 1000}s (${last})`);
}
/** The sandbox id in what `boat new` printed, from whichever line carries one. */
function sandboxId(lines) {
    for (const line of lines)
        if (typeof line['id'] === 'string')
            return line['id'];
    return undefined;
}
function validate(options) {
    for (const key of Object.keys(options)) {
        if (!OPTION_KEYS.includes(key))
            throw new Error(`boat(): unknown option "${key}". It takes: ${OPTION_KEYS.join(', ')}.`);
    }
    if (options.type !== undefined && !TYPES.includes(options.type))
        throw new Error(`boat(): type must be one of ${TYPES.join(', ')}; got ${JSON.stringify(options.type)}.`);
    if (options.ttlSeconds !== undefined && !(Number.isInteger(options.ttlSeconds) && options.ttlSeconds >= 60)) {
        throw new Error(`boat(): ttlSeconds must be a whole number of at least 60; got ${JSON.stringify(options.ttlSeconds)}.`);
    }
    for (const port of options.localhost ?? []) {
        if (!(Number.isInteger(port) && port > 0 && port < 65536))
            throw new Error(`boat(): localhost takes port numbers; got ${JSON.stringify(port)}.`);
        if (port === CDP_PORT)
            throw new Error(`boat(): localhost cannot forward port ${CDP_PORT}, which Chrome's DevTools uses inside the sandbox.`);
    }
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
export function boat(options = {}) {
    return boatWith(boatCli(), options);
}
/** `boat()` over a given CLI, so tests can stand in for the real one. */
export function boatWith(cli, options = {}) {
    validate(options);
    const type = options.type ?? 'small';
    const ttlSeconds = options.ttlSeconds ?? 3600;
    const localhost = [...new Set(options.localhost ?? [])];
    /** The tunnels of each lease this process holds, to close at release. */
    const tunnels = new Map();
    /** Deletes a sandbox and says what happened, for an error message; never throws. */
    const discard = (id, env) => cli.run(['delete', id, '--yes', '--json'], { env, signal: AbortSignal.timeout(30_000) }).then(() => 'the sandbox was deleted', (cause) => `deleting the sandbox failed, so Boat removes it after ttlSeconds: ${messageOf(cause)}`);
    const closeTunnels = (id) => {
        for (const tunnel of tunnels.get(id) ?? [])
            tunnel.stop();
        tunnels.delete(id);
    };
    return {
        name: 'boat',
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        async acquire(request) {
            const { env } = request;
            // Not cancellable on purpose: a `boat new` killed halfway can leave a sandbox whose id was never read.
            const created = await cli.run(['new', '--no-env', '--no-snapshots', '--type', type, '--ttl', String(ttlSeconds), '--name', sandboxName(request), '--json'], { env });
            const id = sandboxId(created);
            if (id === undefined)
                throw new Error('boat new printed no sandbox id');
            const held = [];
            tunnels.set(id, held);
            try {
                if (request.signal.aborted)
                    throw new Error('the request was cancelled while the sandbox started');
                request.log(`sandbox ${id}`);
                const signal = AbortSignal.any([request.signal, AbortSignal.timeout(START_TIMEOUT_MS)]);
                await cli.run(['exec', id, '--detach', '--json', '--', 'bash', '-lc', START_CHROME], { env, signal });
                const port = await freePort();
                held.push(await cli.hold(['forward', id, '--remote', String(CDP_PORT), '--local', String(port), '--json'], { env, signal }));
                for (const local of localhost) {
                    held.push(await cli.hold(['forward', id, '--reverse', '--local', String(local), '--remote', String(local), '--json'], { env, signal }));
                }
                const cdpEndpoint = await browserEndpoint(port, signal);
                return { id, cdpEndpoint };
            }
            catch (cause) {
                closeTunnels(id);
                const log = await cli
                    .run(['exec', id, '--json', '--', 'bash', '-lc', `tail -c 600 ${CHROME_LOG} 2>/dev/null`], { env, signal: AbortSignal.timeout(15_000) })
                    .then((lines) => String(lines.at(-1)?.['stdout'] ?? '').trim(), () => '');
                throw new Error(`${messageOf(cause)}; ${await discard(id, env)}${log === '' ? '' : `\nChrome's output:\n${log}`}`);
            }
        },
        async release(lease, context) {
            closeTunnels(lease.id);
            await cli.run(['delete', lease.id, '--yes', '--json'], { env: context.env, signal: context.signal });
        },
        async sweep(context) {
            const prefix = namePrefix(context.runId, context.targetName);
            const listed = await cli.run(['list', '--json'], { env: context.env, signal: context.signal });
            const sandboxes = listed.flatMap((line) => (Array.isArray(line['sandboxes']) ? line['sandboxes'] : []));
            const open = sandboxes.filter((sandbox) => typeof sandbox['name'] === 'string' && sandbox['name'].startsWith(prefix)).map((sandbox) => String(sandbox['id']));
            const settled = await Promise.allSettled(open.map((id) => cli.run(['delete', id, '--yes', '--json'], { env: context.env, signal: context.signal })));
            const deleted = open.filter((_, index) => settled[index]?.status === 'fulfilled');
            const failed = open.flatMap((id, index) => {
                const result = settled[index];
                return result?.status === 'rejected' ? [`${id} (${messageOf(result.reason)})`] : [];
            });
            if (failed.length > 0) {
                throw new Error(`deleted ${deleted.length === 0 ? 'none' : deleted.join(', ')}; could not delete ${failed.join(', ')}, so Boat removes them after ttlSeconds`);
            }
            return deleted;
        },
        downloads: {
            dir: DOWNLOADS_DIR,
            async read(lease, file, context) {
                const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-boat-'));
                const local = path.join(dir, 'download');
                try {
                    await cli.run(['scp', `${lease.id}:${file}`, local, '--json'], { env: context.env, signal: context.signal });
                    return new Uint8Array(await fs.readFile(local));
                }
                finally {
                    await fs.rm(dir, { recursive: true, force: true });
                }
            },
        },
    };
}
