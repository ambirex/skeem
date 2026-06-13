import type { CliGlobalOptions } from "skeem";

/** Parsed launch configuration for the skeem MCP server. */
export interface ServerArgs {
  /** Directory the runtime resolves `.skeemrc.yaml` from (walks upward). */
  cwd: string;
  /** Connection-level CLI options applied to every tool call. */
  baseCli: CliGlobalOptions;
  /** When true, only read tools are registered. */
  readOnly: boolean;
}

const VALUE_FLAGS = new Set(["--profile", "--adapter", "--url", "--token", "--actor", "--cwd"]);
const BOOLEAN_FLAGS = new Set(["--read-only"]);

/**
 * Parse `skeem-mcp` launch arguments. Connection settings (adapter/url/token/
 * profile/actor) are fixed for the lifetime of the server; per-call options
 * (dry-run, idempotency key, …) arrive as tool arguments instead.
 *
 * Throws a plain `Error` on an unknown flag or missing value — the bin wrapper
 * reports it to stderr and exits non-zero.
 */
export function parseServerArgs(argv: string[]): ServerArgs {
  const values: Record<string, string> = {};
  let readOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);

    if (BOOLEAN_FLAGS.has(name)) {
      readOnly = true;
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(
        `Unknown argument "${arg}". Supported: --profile, --adapter, --url, --token, --actor, --cwd, --read-only.`,
      );
    }

    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined) {
      throw new Error(`Missing value for "${name}".`);
    }
    values[name] = value;
  }

  const baseCli: CliGlobalOptions = {
    ...(values["--adapter"] ? { adapter: values["--adapter"] } : {}),
    ...(values["--url"] ? { url: values["--url"] } : {}),
    ...(values["--token"] ? { token: values["--token"] } : {}),
    ...(values["--profile"] ? { profile: values["--profile"] } : {}),
    ...(values["--actor"] ? { actor: values["--actor"] } : {}),
    json: true,
    noCache: false,
    refresh: false,
    dryRun: false,
    yes: true,
    verbose: false,
    noRollback: false,
    allowDestructive: false,
  };

  return {
    cwd: values["--cwd"] ?? process.cwd(),
    baseCli,
    readOnly,
  };
}
