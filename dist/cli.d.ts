/** The `boat` command line, as the two things the provider needs from it: a command that ends, and one that stays up. */
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
export declare function jsonLines(text: string): Record<string, unknown>[];
/** The real CLI, found on `PATH` as `command`. */
export declare function boatCli(command?: string): BoatCli;
