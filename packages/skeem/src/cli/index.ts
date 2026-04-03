import { toErrorEnvelope, writeEnvelope } from "../output/formatter.js";
import { UsageError } from "../errors/index.js";
import { SkeemRuntime, parseWhere, readExecPlanFromStdin } from "../core/runtime.js";
import type { CliGlobalOptions } from "../types/index.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "no-cache",
  "refresh",
  "dry-run",
  "yes",
  "verbose",
  "no-rollback",
  "counts",
]);

const SHORT_FLAGS: Record<string, string> = {
  y: "yes",
  v: "verbose",
};

const GLOBAL_VALUE_FLAGS = new Set(["adapter", "url", "token", "profile", "actor", "context", "idempotency-key"]);

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);
  const cli = extractGlobalOptions(parsed);
  const json = cli.json || !process.stdout.isTTY;

  try {
    const command = parsed.positionals[0];
    if (!command) {
      throw new UsageError(helpText());
    }

    const runtime = await SkeemRuntime.create(process.cwd(), cli);
    const rest = parsed.positionals.slice(1);

    switch (command) {
      case "ls": {
        writeEnvelope(await runtime.ls({ counts: parsed.booleans.has("counts") }), { json });
        return;
      }
      case "get": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem get <collection> <id> [--expand relation]");
        }
        writeEnvelope(
          await runtime.get(collection, parsePrimaryKey(id), {
            expand: parsed.flags.get("expand") ?? [],
            cli,
          }),
          { json },
        );
        return;
      }
      case "find": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem find <collection> [--where field=value]");
        }
        writeEnvelope(
          await runtime.find(collection, parseWhere(parsed.flags.get("where") ?? []), {
            ...(parseOptionalInt(parsed.flags.get("limit")?.at(-1)) !== undefined
              ? { limit: parseOptionalInt(parsed.flags.get("limit")?.at(-1)) }
              : {}),
            ...(parseOptionalInt(parsed.flags.get("offset")?.at(-1)) !== undefined
              ? { offset: parseOptionalInt(parsed.flags.get("offset")?.at(-1)) }
              : {}),
            ...(parsed.flags.get("sort")?.at(-1) ? { sort: parsed.flags.get("sort")?.at(-1) } : {}),
            expand: parsed.flags.get("expand") ?? [],
            cli,
          }),
          { json },
        );
        return;
      }
      case "create": {
        const [collection] = rest;
        if (!collection) {
          throw new UsageError("Usage: skeem create <collection> [--field value]");
        }
        writeEnvelope(await runtime.create(collection, extractFieldEntries(parsed, new Set()), cli), { json });
        return;
      }
      case "update": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem update <collection> <id> [--field value]");
        }
        writeEnvelope(await runtime.update(collection, parsePrimaryKey(id), extractFieldEntries(parsed, new Set()), cli), { json });
        return;
      }
      case "delete": {
        const [collection, id] = rest;
        if (!collection || id === undefined) {
          throw new UsageError("Usage: skeem delete <collection> <id>");
        }
        writeEnvelope(await runtime.delete(collection, parsePrimaryKey(id), cli), { json });
        return;
      }
      case "exec": {
        writeEnvelope(await runtime.exec(await readExecPlanFromStdin(), cli), { json });
        return;
      }
      case "cache": {
        const [subcommand] = rest;
        if (subcommand === "show") {
          writeEnvelope(await runtime.cacheShow(), { json });
          return;
        }
        if (subcommand === "clear") {
          writeEnvelope(await runtime.cacheClear(), { json });
          return;
        }
        throw new UsageError("Usage: skeem cache <show|clear>");
      }
      default:
        throw new UsageError(helpText());
    }
  } catch (error) {
    const command = parsed.positionals[0];
    writeEnvelope(toErrorEnvelope(error, command), { json });
    process.exitCode = 1;
  }
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
      if (equalsIndex !== -1) {
        appendFlag(flags, name, token.slice(equalsIndex + 1));
        continue;
      }

      if (BOOLEAN_FLAGS.has(name)) {
        booleans.add(name);
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        booleans.add(name);
        continue;
      }
      appendFlag(flags, name, next);
      index += 1;
      continue;
    }

    if (token.startsWith("-") && token.length === 2) {
      const expanded = SHORT_FLAGS[token.slice(1)];
      if (expanded) {
        booleans.add(expanded);
        continue;
      }
    }

    positionals.push(token);
  }

  return { positionals, flags, booleans };
}

function extractGlobalOptions(parsed: ParsedArgs): CliGlobalOptions {
  const contextRaw = parsed.flags.get("context")?.at(-1);
  return {
    ...(parsed.flags.get("adapter")?.at(-1) ? { adapter: parsed.flags.get("adapter")?.at(-1) } : {}),
    ...(parsed.flags.get("url")?.at(-1) ? { url: parsed.flags.get("url")?.at(-1) } : {}),
    ...(parsed.flags.get("token")?.at(-1) ? { token: parsed.flags.get("token")?.at(-1) } : {}),
    ...(parsed.flags.get("profile")?.at(-1) ? { profile: parsed.flags.get("profile")?.at(-1) } : {}),
    json: parsed.booleans.has("json"),
    noCache: parsed.booleans.has("no-cache"),
    refresh: parsed.booleans.has("refresh"),
    dryRun: parsed.booleans.has("dry-run"),
    yes: parsed.booleans.has("yes"),
    verbose: parsed.booleans.has("verbose"),
    noRollback: parsed.booleans.has("no-rollback"),
    ...(parsed.flags.get("actor")?.at(-1) ? { actor: parsed.flags.get("actor")?.at(-1) } : {}),
    ...(contextRaw ? { context: parseJsonObject(contextRaw) } : {}),
    ...(parsed.flags.get("idempotency-key")?.at(-1)
      ? { idempotencyKey: parsed.flags.get("idempotency-key")?.at(-1) }
      : {}),
  };
}

function extractFieldEntries(parsed: ParsedArgs, additionalKnownFlags: Set<string>): Array<[string, string]> {
  const knownFlags = new Set<string>([
    ...GLOBAL_VALUE_FLAGS,
    "where",
    "limit",
    "offset",
    "sort",
    "expand",
    ...additionalKnownFlags,
  ]);

  const entries: Array<[string, string]> = [];
  for (const [key, values] of parsed.flags.entries()) {
    if (knownFlags.has(key)) {
      continue;
    }
    for (const value of values) {
      entries.push([key, value]);
    }
  }
  return entries;
}

function appendFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name) ?? [];
  existing.push(value);
  flags.set(name, existing);
}

function parsePrimaryKey(value: string): string | number {
  return /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
}

function parseOptionalInt(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("Expected --context to be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function helpText(): string {
  return [
    "skeem",
    "",
    "Usage:",
    "  skeem ls [--counts]",
    "  skeem get <collection> <id> [--expand relation]",
    "  skeem find <collection> [--where field=value] [--limit N] [--offset N] [--sort field]",
    "  skeem create <collection> [--field value]",
    "  skeem update <collection> <id> [--field value]",
    "  skeem delete <collection> <id>",
    "  skeem exec < plan.json",
    "  skeem cache <show|clear>",
  ].join("\n");
}
