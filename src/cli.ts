/** The `boat` command line, as the two things the provider needs from it: a command that ends, and one that stays up. */

import { spawn } from 'node:child_process';

export type Env = Readonly<Record<string, string | undefined>>;

export interface RunOptions {
  readonly env: Env;
  readonly signal?: AbortSignal | undefined;
}

/** A tunnel or other command that keeps running until `stop`. */
export interface Held {
  /** The first JSON line the command printed: what it reports once it is up. */
  readonly first: Record<string, unknown>;
  stop(): void;
}

export interface BoatCli {
  /** Runs `boat <args>` to its end and resolves to the JSON lines it printed. Rejects on a non-zero exit. */
  run(args: readonly string[], options: RunOptions): Promise<Record<string, unknown>[]>;
  /** Starts `boat <args>` and resolves once it printed its first JSON line; the command keeps running until `stop`. */
  hold(args: readonly string[], options: RunOptions): Promise<Held>;
}

/** Every line of `text` that is a JSON object, in order. The CLI prints one object per line with `--json`. */
export function jsonLines(text: string): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value === 'object' && value !== null) lines.push(value as Record<string, unknown>);
    } catch {
      // Not JSON: a progress line the CLI printed for people.
    }
  }
  return lines;
}

/** What the CLI said went wrong: its `error` line when it printed one, else the end of its output. */
function failure(args: readonly string[], code: number | null, stdout: string, stderr: string): Error {
  const reported = jsonLines(`${stdout}\n${stderr}`).find((line) => typeof line['error'] === 'string');
  const detail = reported === undefined ? `${stderr}\n${stdout}`.trim().slice(-400) : String(reported['error']);
  return new Error(`boat ${args[0] ?? ''} failed${code === null ? '' : ` (exit ${code})`}: ${detail === '' ? 'no output' : detail}`);
}

/** The environment a `boat` process gets: this process's, overlaid with the run's, with the CLI's self-update off. */
function childEnv(env: Env): NodeJS.ProcessEnv {
  return { ...process.env, ...env, BOAT_NO_UPDATE: '1' };
}

/** The real CLI, found on `PATH` as `command`. */
export function boatCli(command = 'boat'): BoatCli {
  return {
    run(args, { env, signal }) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], signal });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', (cause: NodeJS.ErrnoException) =>
          reject(cause.code === 'ENOENT' ? new Error(`the boat CLI is not installed or not on PATH (looked for "${command}"); see https://boat.dev`) : cause),
        );
        child.on('close', (code) => (code === 0 ? resolve(jsonLines(stdout)) : reject(failure(args, code, stdout, stderr))));
      });
    },
    hold(args, { env, signal }) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let up = false;
        const stop = (): void => void child.kill();
        const onAbort = (): void => {
          stop();
          reject(signal?.reason instanceof Error ? signal.reason : new Error('cancelled'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.stdout.on('data', (chunk: Buffer) => {
          if (up) return;
          stdout += chunk.toString();
          const first = jsonLines(stdout)[0];
          if (first === undefined) return;
          if (typeof first['error'] === 'string') return; // the close handler reports it
          up = true;
          signal?.removeEventListener('abort', onAbort);
          resolve({ first, stop });
        });
        child.on('error', (cause: NodeJS.ErrnoException) =>
          reject(cause.code === 'ENOENT' ? new Error(`the boat CLI is not installed or not on PATH (looked for "${command}"); see https://boat.dev`) : cause),
        );
        child.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort);
          if (!up) reject(failure(args, code, stdout, stderr));
        });
      });
    },
  };
}
